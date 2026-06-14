from __future__ import annotations

import asyncio
import json
import math
from datetime import datetime, timezone
from typing import Any, Callable

from app.clickhouse import get_ch_client
from app.config import settings
from app.services.session_service import (
    is_nse_market_data_window_open,
    is_nse_trading_session_open,
    normalize_broker_status_for_session,
)
from app.services.tick_buffer import TickBuffer

FLUSH_BATCH_SIZE = 500
BROKER_WATCHDOG_INTERVAL_S = 10
STALE_TICK_THRESHOLD_MS = 30_000
BROKER_RESTART_BACKOFF_BASE_MS = 5_000
BROKER_RESTART_BACKOFF_MAX_MS = 60_000
BROKER_RESTART_ALERT_THRESHOLD = 3

STORED_INTERVALS: list[str] = ["1m", "5m", "15m", "1h", "1d"]
INTERVAL_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000,
}


def _bucket_start_ms(timestamp_ms: int, interval: str) -> int:
    ms = INTERVAL_MS[interval]
    return (timestamp_ms // ms) * ms


def _to_dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


class MarketRuntime:
    def __init__(
        self,
        alert_service: Any | None = None,
        broker_adapter: Any | None = None,
        quote_service: Any | None = None,
    ) -> None:
        self.tick_buffer = TickBuffer()
        self._live_quotes: dict[str, dict] = {}
        self._consumer_symbols: dict[str, set[str]] = {}
        self._subscribed: set[str] = set()
        self._status_listeners: list[Callable] = []
        self._status: dict[str, Any] = {
            "source": "upstox",
            "status": "idle",
            "lastTickAt": None,
            "retryInMs": None,
            "error": None,
        }
        self._alert_service = alert_service
        self._broker = broker_adapter
        self._quote_service = quote_service

        # In-memory candle state: key = "{symbol}:{interval}:{bucket_start_ms}"
        self._candle_state: dict[str, dict[str, Any]] = {}
        self._dirty_candles: set[str] = set()

        # Broker watchdog state
        self._broker_restart_in_flight = False
        self._broker_restart_attempts = 0
        self._last_broker_restart_at = 0.0

        self._flush_task: asyncio.Task | None = None
        self._watchdog_task: asyncio.Task | None = None
        self._cleanup_task: asyncio.Task | None = None
        self._running = False

    def set_broker(self, broker: Any) -> None:
        self._broker = broker

    def set_quote_service(self, quote_service: Any) -> None:
        self._quote_service = quote_service

    async def start(self) -> None:
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
        self._watchdog_task = asyncio.create_task(self._watchdog_loop())
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def stop(self) -> None:
        self._running = False
        for task in (self._flush_task, self._watchdog_task, self._cleanup_task):
            if task:
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._flush_task, self._watchdog_task, self._cleanup_task) if t),
            return_exceptions=True,
        )
        await self._flush_pending_ticks()

    async def set_consumer_symbols(self, consumer_id: str, symbols: list[str]) -> None:
        self._consumer_symbols[consumer_id] = set(symbols)
        await self._sync_subscriptions_safe()

    async def clear_consumer_symbols(self, consumer_id: str) -> None:
        self._consumer_symbols.pop(consumer_id, None)
        await self._sync_subscriptions_safe()

    def get_status(self) -> dict[str, Any]:
        return dict(self._status)

    def get_snapshot(self) -> dict[str, Any]:
        active = list(self._subscribed)
        latest_tick_at = self.tick_buffer.get_latest_tick_at(active)
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        return {
            "ts": now_ms,
            "source": self._status["source"],
            "marketState": self._status["status"],
            "prices": self.tick_buffer.get_latest_price_map(active),
            "quotes": self.get_latest_quotes(active),
            "snapshotAgeMs": max(0.0, now_ms - latest_tick_at) if latest_tick_at else None,
            "lastTickAt": self._status["lastTickAt"],
        }

    def get_latest_prices(self) -> dict[str, float]:
        return self.tick_buffer.get_latest_price_map()

    def get_latest_quotes(self, symbols: list[str] | None = None) -> dict[str, dict]:
        active = set(symbols) if symbols else self._subscribed
        return {s: q for s, q in self._live_quotes.items() if s in active}

    def on_status_change(self, handler: Callable) -> None:
        self._status_listeners.append(handler)

    def ingest_tick(self, tick: dict) -> None:
        self.tick_buffer.ingest(tick)
        recorded_at = tick.get("recorded_at")
        self._set_status("live", lastTickAt=recorded_at)

        if self._broker_restart_attempts > 0:
            self._notify_alert({
                "key": "broker-feed-recovered",
                "severity": "info",
                "title": "Broker feed recovered",
                "message": (
                    f"Live ticks resumed after {self._broker_restart_attempts} "
                    "watchdog restart attempt(s)."
                ),
            })
            self._broker_restart_attempts = 0

        if tick.get("quote"):
            self._merge_quote(tick["symbol"], tick["quote"])

        self._update_candle_state(tick)

    def _update_candle_state(self, tick: dict) -> None:
        symbol = tick.get("symbol")
        price = tick.get("price")
        volume = tick.get("volume")
        recorded_at = tick.get("recorded_at")

        if not symbol or price is None or not math.isfinite(float(price)):
            return
        if recorded_at is None or not math.isfinite(float(recorded_at)):
            return

        price = float(price)
        volume = float(volume) if volume is not None else 0.0
        ts_ms = int(recorded_at)

        for interval in STORED_INTERVALS:
            bucket_ms = _bucket_start_ms(ts_ms, interval)
            key = f"{symbol}:{interval}:{bucket_ms}"

            if key not in self._candle_state:
                self._candle_state[key] = {
                    "symbol": symbol,
                    "interval": interval,
                    "bucket_start": bucket_ms,
                    "first_trade_at": ts_ms,
                    "last_trade_at": ts_ms,
                    "open": price,
                    "high": price,
                    "low": price,
                    "close": price,
                    "volume": volume,
                    "source": "broker",
                }
            else:
                candle = self._candle_state[key]
                if ts_ms < candle["first_trade_at"]:
                    candle["first_trade_at"] = ts_ms
                    candle["open"] = price
                if ts_ms >= candle["last_trade_at"]:
                    candle["last_trade_at"] = ts_ms
                    candle["close"] = price
                candle["high"] = max(candle["high"], price)
                candle["low"] = min(candle["low"], price)
                candle["volume"] += volume

            self._dirty_candles.add(key)

    def _set_status(self, status: str, **kwargs: Any) -> None:
        self._status["status"] = status
        for k, v in kwargs.items():
            if v is not None:
                self._status[k] = v
        normalized = normalize_broker_status_for_session(self._status)
        self._status = normalized
        for handler in self._status_listeners:
            try:
                result = handler(dict(self._status))
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception:
                pass

    def _merge_quote(self, symbol: str, patch: dict) -> None:
        prev = self._live_quotes.get(symbol, {"symbol": symbol})
        merged = {**prev, **patch, "symbol": symbol}
        depth = patch.get("depth") or prev.get("depth") or {}
        if depth:
            merged["depth"] = {
                "buy": patch.get("depth", {}).get("buy") or prev.get("depth", {}).get("buy", []),
                "sell": patch.get("depth", {}).get("sell") or prev.get("depth", {}).get("sell", []),
            }
        self._live_quotes[symbol] = merged

    async def _flush_loop(self) -> None:
        while self._running:
            await asyncio.sleep(settings.MARKET_FLUSH_MS / 1000)
            try:
                await self._flush_pending_ticks()
            except Exception:
                pass

    async def _flush_pending_ticks(self) -> None:
        ticks = self.tick_buffer.drain_pending()
        dirty_keys = set(self._dirty_candles)
        self._dirty_candles.clear()
        candles = [self._candle_state[k] for k in dirty_keys if k in self._candle_state]

        if not ticks and not candles:
            return

        loop = asyncio.get_event_loop()

        def _write_to_ch() -> None:
            ch = get_ch_client()
            if ticks:
                for offset in range(0, len(ticks), FLUSH_BATCH_SIZE):
                    chunk = ticks[offset : offset + FLUSH_BATCH_SIZE]
                    _insert_ticks_ch(ch, chunk)
            if candles:
                _upsert_candles_ch(ch, candles)

        try:
            await loop.run_in_executor(None, _write_to_ch)
        except Exception:
            self.tick_buffer.restore_pending(ticks)
            self._dirty_candles.update(dirty_keys)
            raise

    async def _sync_subscriptions(self) -> None:
        if not self._broker:
            return

        wanted: set[str] = set()
        for symbols in self._consumer_symbols.values():
            wanted.update(symbols)

        to_sub = [s for s in wanted if s not in self._subscribed]
        to_unsub = [s for s in self._subscribed if s not in wanted]

        if to_sub:
            await self._broker.subscribe(to_sub)
            self._subscribed.update(to_sub)
            await self._hydrate_quotes(to_sub)

        if to_unsub:
            await self._broker.unsubscribe(to_unsub)
            for s in to_unsub:
                self._subscribed.discard(s)
                self._live_quotes.pop(s, None)
                self.tick_buffer.delete_symbol(s)

    async def _sync_subscriptions_safe(self) -> None:
        try:
            await self._sync_subscriptions()
        except Exception as exc:
            self._set_status(
                "degraded" if self._status["status"] != "offline" else "offline",
                error=str(exc),
            )

    async def _hydrate_quotes(self, symbols: list[str]) -> None:
        if not self._quote_service or not symbols:
            return
        try:
            quotes = await self._quote_service.get_quotes(symbols)
            for quote in quotes:
                sym = quote.get("symbol") or quote.symbol if hasattr(quote, "symbol") else None
                if sym:
                    self._merge_quote(sym, quote if isinstance(quote, dict) else quote.model_dump())
        except Exception:
            pass

    async def _watchdog_loop(self) -> None:
        while self._running:
            await asyncio.sleep(BROKER_WATCHDOG_INTERVAL_S)
            try:
                await self._watch_broker_health()
            except Exception:
                pass

    async def _watch_broker_health(self) -> None:
        if self._broker_restart_in_flight or not self._broker:
            return
        if not is_nse_trading_session_open():
            return

        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        last_tick_at = self._status.get("lastTickAt")
        tick_age_ms = (
            max(0.0, now_ms - float(last_tick_at))
            if last_tick_at is not None
            else float("inf")
        )

        has_demand = bool(self._subscribed)
        recoverable = not self._status.get("error") or "missing upstox_access_token" not in (
            self._status.get("error") or ""
        ).lower()

        stale_live = self._status["status"] == "live" and tick_age_ms > STALE_TICK_THRESHOLD_MS
        stalled = self._status["status"] in ("connecting", "degraded") and tick_age_ms > STALE_TICK_THRESHOLD_MS * 2
        offline_demand = (
            has_demand
            and recoverable
            and self._status["status"] == "offline"
            and tick_age_ms > STALE_TICK_THRESHOLD_MS * 2
        )

        if not (stale_live or stalled or offline_demand):
            return

        backoff_ms = min(
            BROKER_RESTART_BACKOFF_BASE_MS * (2 ** min(self._broker_restart_attempts, 5)),
            BROKER_RESTART_BACKOFF_MAX_MS,
        )
        if (now_ms - self._last_broker_restart_at * 1000) < backoff_ms:
            return

        reason = (
            f"No live tick for {round(tick_age_ms / 1000)}s during market hours."
            if stale_live
            else "Broker feed is offline during market hours."
            if offline_demand
            else "Broker feed stalled during market hours."
        )

        self._broker_restart_in_flight = True
        self._last_broker_restart_at = now_ms / 1000
        self._broker_restart_attempts += 1

        self._notify_alert({
            "key": "broker-feed-stale",
            "severity": "warning",
            "title": "Broker feed stale — restarting",
            "message": reason,
            "metadata": {
                "status": self._status["status"],
                "tickAgeMs": round(tick_age_ms) if math.isfinite(tick_age_ms) else None,
                "restartAttempt": self._broker_restart_attempts,
            },
        })

        if self._broker_restart_attempts >= BROKER_RESTART_ALERT_THRESHOLD:
            self._notify_alert({
                "key": "broker-restart-threshold",
                "severity": "critical",
                "title": "Broker restart threshold exceeded",
                "message": (
                    f"Watchdog restarted broker {self._broker_restart_attempts} "
                    "times without stable recovery."
                ),
            })

        self._set_status("connecting", error=reason, retryInMs=backoff_ms)

        try:
            await self._broker.disconnect()
        except Exception:
            pass
        try:
            await self._broker.connect()
        except Exception as exc:
            self._notify_alert({
                "key": "broker-restart-failed",
                "severity": "critical",
                "title": "Broker restart failed",
                "message": str(exc),
            })
        finally:
            self._broker_restart_in_flight = False

    async def _cleanup_loop(self) -> None:
        while self._running:
            await asyncio.sleep(12 * 3600)
            try:
                await self._cleanup_expired_market_data()
                self._evict_stale_candle_state()
            except Exception:
                pass

    async def _cleanup_expired_market_data(self) -> None:
        # ClickHouse TTL handles retention automatically; this is a manual safety pass.
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _cleanup_ch)

    def _evict_stale_candle_state(self) -> None:
        now_ms = datetime.now(timezone.utc).timestamp() * 1000
        cutoff_ms = now_ms - INTERVAL_MS["1d"] * 2
        stale = [k for k, v in self._candle_state.items() if v["bucket_start"] < cutoff_ms]
        for k in stale:
            self._candle_state.pop(k, None)

    def _notify_alert(self, event: dict) -> None:
        if not self._alert_service:
            return
        asyncio.create_task(self._alert_service.notify(event))

    # ------------------------------------------------------------------
    # Candle query API (used by market routes and history service)
    # ------------------------------------------------------------------

    async def get_candles(
        self,
        symbol: str,
        days: int,
        interval: str,
        *,
        date: str | None = None,
    ) -> list[dict]:
        stored = await self.get_stored_candles(symbol, days, interval, date=date)
        if stored:
            return stored
        return await self.get_candles_from_ticks(symbol, days, interval, date=date)

    async def get_stored_candles(
        self,
        symbol: str,
        days: int,
        interval: str,
        *,
        date: str | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, _query_stored_candles, symbol, days, interval, date
        )

    async def get_candles_from_ticks(
        self,
        symbol: str,
        days: int,
        interval: str,
        *,
        date: str | None = None,
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, _query_candles_from_ticks, symbol, days, interval, date
        )

    async def store_candles(
        self,
        symbol: str,
        interval: str,
        candles: list[dict],
        source: str = "provider",
    ) -> None:
        if not candles:
            return
        rows = []
        for c in candles:
            try:
                bucket_ms = int(datetime.fromisoformat(c["time"]).timestamp() * 1000)
            except (KeyError, ValueError):
                continue
            rows.append({
                "symbol": symbol,
                "interval": interval,
                "bucket_start": bucket_ms,
                "first_trade_at": bucket_ms,
                "last_trade_at": bucket_ms + INTERVAL_MS.get(interval, 60_000) - 1,
                "open": float(c["open"]),
                "high": float(c["high"]),
                "low": float(c["low"]),
                "close": float(c["close"]),
                "volume": float(c.get("volume") or 0),
                "source": source,
            })
        if rows:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _upsert_candles_ch, get_ch_client(), rows)


# ---------------------------------------------------------------------------
# Pure-sync ClickHouse helpers (run in executor to avoid blocking event loop)
# ---------------------------------------------------------------------------

def _insert_ticks_ch(ch: Any, ticks: list[dict]) -> None:
    def _f(v: Any) -> float:
        try:
            return float(v) if v is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    def _i(v: Any) -> int:
        try:
            return int(v) if v is not None else 0
        except (TypeError, ValueError):
            return 0

    def _bp(levels: list, idx: int) -> float:
        return _f(levels[idx]["price"]) if idx < len(levels) else 0.0

    def _bq(levels: list, idx: int) -> int:
        return _i(levels[idx].get("quantity")) if idx < len(levels) else 0

    rows = []
    for t in ticks:
        q = t.get("quote") or {}
        depth = q.get("depth") or {}
        buy = depth.get("buy") or []
        sell = depth.get("sell") or []

        rows.append((
            t["symbol"],
            _to_dt(int(t["recorded_at"])) if t.get("recorded_at") is not None else datetime.now(timezone.utc),
            _f(t["price"]),
            _f(q.get("close")),           # prev_close
            _f(q.get("open")),            # day_open
            _f(q.get("high")),            # day_high
            _f(q.get("low")),             # day_low
            _f(q.get("averagePrice")),    # avg_price / ATP
            float(t["volume"]) if t.get("volume") is not None else None,  # volume delta (nullable)
            _f(t.get("cum_volume")),      # cumulative day volume
            _i(t.get("last_trade_qty")),  # last traded qty
            _f(q.get("totalBuyQuantity")),
            _f(q.get("totalSellQuantity")),
            _bp(buy, 0),  _bq(buy, 0),   # bid level 1
            _bp(sell, 0), _bq(sell, 0),  # ask level 1
            _bp(buy, 1),  _bq(buy, 1),   # bid level 2
            _bp(buy, 2),  _bq(buy, 2),   # bid level 3
            _bp(buy, 3),  _bq(buy, 3),   # bid level 4
            _bp(buy, 4),  _bq(buy, 4),   # bid level 5
            _bp(sell, 1), _bq(sell, 1),  # ask level 2
            _bp(sell, 2), _bq(sell, 2),  # ask level 3
            _bp(sell, 3), _bq(sell, 3),  # ask level 4
            _bp(sell, 4), _bq(sell, 4),  # ask level 5
            _f(t.get("oi")),
            _f(t.get("iv")),
            _f(q.get("netChange")),
            _f(q.get("percentChange")),
            json.dumps(t.get("payload") or {}),
        ))

    ch.execute(
        """
        INSERT INTO market_ticks (
            symbol, recorded_at, price,
            prev_close, day_open, day_high, day_low, avg_price,
            volume, cum_volume, last_trade_qty,
            total_buy_qty, total_sell_qty,
            bid_price, bid_qty, ask_price, ask_qty,
            bid_price_2, bid_qty_2, bid_price_3, bid_qty_3,
            bid_price_4, bid_qty_4, bid_price_5, bid_qty_5,
            ask_price_2, ask_qty_2, ask_price_3, ask_qty_3,
            ask_price_4, ask_qty_4, ask_price_5, ask_qty_5,
            oi, iv, net_change, pct_change,
            payload
        ) VALUES
        """,
        rows,
        types_check=False,
    )


def _upsert_candles_ch(ch: Any, candles: list[dict]) -> None:
    if not candles:
        return
    ch.execute(
        """
        INSERT INTO market_candles
          (symbol, interval, bucket_start, first_trade_at, last_trade_at,
           open, high, low, close, volume, source, updated_at)
        VALUES
        """,
        [
            (
                c["symbol"],
                c["interval"],
                _to_dt(c["bucket_start"]),
                _to_dt(c["first_trade_at"]),
                _to_dt(c["last_trade_at"]),
                float(c["open"]),
                float(c["high"]),
                float(c["low"]),
                float(c["close"]),
                float(c["volume"]),
                c.get("source", "broker"),
                datetime.now(timezone.utc),
            )
            for c in candles
        ],
        types_check=False,
    )


def _query_stored_candles(
    symbol: str, days: int, interval: str, date: str | None
) -> list[dict]:
    ch = get_ch_client()
    if date:
        rows = ch.execute(
            """
            SELECT bucket_start, open, high, low, close, volume
            FROM market_candles FINAL
            WHERE symbol = %(symbol)s
              AND interval = %(interval)s
              AND toDate(bucket_start) = %(date)s
            ORDER BY bucket_start ASC
            """,
            {"symbol": symbol, "interval": interval, "date": date},
        )
    else:
        rows = ch.execute(
            """
            SELECT bucket_start, open, high, low, close, volume
            FROM market_candles FINAL
            WHERE symbol = %(symbol)s
              AND interval = %(interval)s
              AND bucket_start >= now() - INTERVAL %(days)s DAY
            ORDER BY bucket_start ASC
            """,
            {"symbol": symbol, "interval": interval, "days": days},
        )
    return [
        {
            "time": row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "volume": float(row[5] or 0),
        }
        for row in rows
    ]


def _query_candles_from_ticks(
    symbol: str, days: int, interval: str, date: str | None
) -> list[dict]:
    ch = get_ch_client()
    interval_ms = INTERVAL_MS.get(interval, 60_000)

    if date:
        rows = ch.execute(
            """
            SELECT price, volume, recorded_at
            FROM market_ticks
            WHERE symbol = %(symbol)s
              AND toDate(recorded_at) = %(date)s
            ORDER BY recorded_at ASC
            """,
            {"symbol": symbol, "date": date},
        )
    else:
        rows = ch.execute(
            """
            SELECT price, volume, recorded_at
            FROM market_ticks
            WHERE symbol = %(symbol)s
              AND recorded_at >= now() - INTERVAL %(days)s DAY
            ORDER BY recorded_at ASC
            """,
            {"symbol": symbol, "days": days},
        )

    buckets: dict[int, dict] = {}
    for price_val, volume_val, recorded_at in rows:
        ts_ms = int(recorded_at.timestamp() * 1000) if hasattr(recorded_at, "timestamp") else int(recorded_at)
        bucket = (ts_ms // interval_ms) * interval_ms
        price = float(price_val)
        volume = float(volume_val or 0)

        if bucket not in buckets:
            buckets[bucket] = {
                "time": _to_dt(bucket).isoformat(),
                "open": price, "high": price, "low": price, "close": price,
                "volume": volume,
            }
        else:
            c = buckets[bucket]
            c["high"] = max(c["high"], price)
            c["low"] = min(c["low"], price)
            c["close"] = price
            c["volume"] += volume

    return [buckets[b] for b in sorted(buckets)]


def _cleanup_ch() -> None:
    # ClickHouse TTL rules in the table DDL handle automatic data expiry.
    # This is a no-op — we rely on TTL defined in clickhouse.py init.
    pass
