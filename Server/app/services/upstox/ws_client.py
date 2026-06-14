from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import websockets

from app.config import settings
from app.services.upstox import MarketDataFeedV3_pb2 as pb

SUBSCRIBE_BATCH_SIZE = 200
AUTHORIZE_URL = "https://api.upstox.com/v3/feed/market-data-feed/authorize"
WS_BASE_URL = "wss://api.upstox.com/v3/feed/market-data-feed/ws"

RECONNECT_BACKOFF_BASE_MS = 5000
RECONNECT_BACKOFF_MAX_MS = 60000
STALE_TICK_THRESHOLD_MS = 30000
WATCHDOG_INTERVAL_MS = 10000

RequestMode = pb.RequestMode


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
        return num if num == num else None
    except (ValueError, TypeError):
        return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _pick_live_ohlc(rows: list[Any]) -> dict | None:
    if not rows:
        return None
    preferred = ["1d", "d1", "day"]
    for interval in preferred:
        for row in rows:
            if isinstance(row, dict) and row.get("interval", "").lower() == interval:
                return row
    if isinstance(rows[0], dict):
        return rows[0]
    return None


def _normalize_depth(bid_ask_rows: list[Any]) -> dict:
    buy = []
    sell = []
    if not bid_ask_rows:
        return {"buy": buy, "sell": sell}
    for row in bid_ask_rows:
        if isinstance(row, dict):
            bq = _parse_int(row.get("bidQ"))
            bp = _parse_number(row.get("bidP"))
            aq = _parse_int(row.get("askQ"))
            ap = _parse_number(row.get("askP"))
            if bq and bq > 0:
                buy.append({"quantity": bq, "price": bp or 0, "orders": 0})
            if aq and aq > 0:
                sell.append({"quantity": aq, "price": ap or 0, "orders": 0})
    return {"buy": buy, "sell": sell}


def _ltpc_to_dict(ltpc_msg: Any) -> dict:
    return {
        "ltp": _parse_number(ltpc_msg.ltp),
        "ltt": ltpc_msg.ltt if ltpc_msg.ltt else None,
        "ltq": _parse_int(ltpc_msg.ltq),
        "cp": _parse_number(ltpc_msg.cp),
    }


def _market_level_to_dict(ml_msg: Any) -> dict:
    if ml_msg is None:
        return {"bidAskQuote": []}
    quotes = []
    for q in (ml_msg.bidAskQuote or []):
        quotes.append({
            "bidQ": q.bidQ,
            "bidP": q.bidP,
            "askQ": q.askQ,
            "askP": q.askP,
        })
    return {"bidAskQuote": quotes}


def _market_ohlc_to_dict(ohlc_msg: Any) -> dict:
    if ohlc_msg is None:
        return {"ohlc": []}
    ohlc_list = []
    for o in (ohlc_msg.ohlc or []):
        ohlc_list.append({
            "interval": o.interval,
            "open": o.open,
            "high": o.high,
            "low": o.low,
            "close": o.close,
            "vol": o.vol,
            "ts": o.ts,
        })
    return {"ohlc": ohlc_list}


def _option_greeks_to_dict(og_msg: Any) -> dict:
    if og_msg is None:
        return {}
    return {
        "delta": og_msg.delta,
        "theta": og_msg.theta,
        "gamma": og_msg.gamma,
        "vega": og_msg.vega,
        "rho": og_msg.rho,
    }


def _build_quote_patch(
    symbol: str,
    instrument_key: str,
    feed: dict,
    recorded_at: int,
) -> dict:
    full_feed = feed.get("fullFeed") or {}
    market_ff = full_feed.get("marketFF") or {}
    index_ff = full_feed.get("indexFF") or {}
    ltpc = feed.get("ltpc") or market_ff.get("ltpc") or index_ff.get("ltpc") or {}
    ohlc_wrapper = market_ff.get("marketOHLC") or index_ff.get("marketOHLC") or {}
    ohlc = _pick_live_ohlc(ohlc_wrapper.get("ohlc")) or {}
    market_level = market_ff.get("marketLevel") or {}
    depth_raw = market_level.get("bidAskQuote") or []
    depth = _normalize_depth(depth_raw)

    last_price = _parse_number(ltpc.get("ltp"))
    close = _parse_number(ltpc.get("cp")) or _parse_number(ohlc.get("close"))
    net_change = (last_price - close) if (last_price is not None and close is not None) else None

    return {
        "symbol": symbol,
        "instrumentKey": instrument_key,
        "lastPrice": last_price,
        "open": _parse_number(ohlc.get("open")),
        "high": _parse_number(ohlc.get("high")),
        "low": _parse_number(ohlc.get("low")),
        "close": close,
        "volume": _parse_int(market_ff.get("vtt")) or _parse_int(ohlc.get("vol")),
        "averagePrice": _parse_number(market_ff.get("atp")),
        "netChange": net_change,
        "percentChange": (net_change / close * 100) if (net_change is not None and close and close != 0) else None,
        "totalBuyQuantity": _parse_number(market_ff.get("tbq")),
        "totalSellQuantity": _parse_number(market_ff.get("tsq")),
        "lastTradeTime": str(ltpc.get("ltt")) if ltpc.get("ltt") is not None else None,
        "timestamp": datetime.fromtimestamp(recorded_at / 1000, tz=UTC).isoformat(),
        "depth": depth,
    }


def _decode_feed_response(buffer: bytes) -> dict:
    feed_response = pb.FeedResponse()
    feed_response.ParseFromString(buffer)

    result: dict = {
        "type": pb.Type.Name(feed_response.type).lower(),
        "currentTs": feed_response.currentTs,
        "feeds": {},
    }

    if feed_response.HasField("marketInfo"):
        info = feed_response.marketInfo
        result["marketInfo"] = {
            "segmentStatus": dict(info.segmentStatus),
        }

    for instrument_key, feed in feed_response.feeds.items():
        feed_dict: dict = {}
        request_mode = pb.RequestMode.Name(feed.requestMode).lower() if feed.HasField("requestMode") else "full"

        which = feed.WhichOneof("FeedUnion")
        if which == "ltpc":
            feed_dict["ltpc"] = _ltpc_to_dict(feed.ltpc)
        elif which == "fullFeed":
            full = feed.fullFeed
            ff_dict: dict = {"requestMode": request_mode}
            union = full.WhichOneof("FullFeedUnion")
            if union == "marketFF":
                mff = full.marketFF
                ff_dict["marketFF"] = {
                    "ltpc": _ltpc_to_dict(mff.ltpc) if mff.HasField("ltpc") else {},
                    "marketLevel": _market_level_to_dict(mff.marketLevel) if mff.HasField("marketLevel") else {},
                    "optionGreeks": _option_greeks_to_dict(mff.optionGreeks) if mff.HasField("optionGreeks") else {},
                    "marketOHLC": _market_ohlc_to_dict(mff.marketOHLC) if mff.HasField("marketOHLC") else {},
                    "atp": mff.atp,
                    "vtt": mff.vtt,
                    "oi": mff.oi,
                    "iv": mff.iv,
                    "tbq": mff.tbq,
                    "tsq": mff.tsq,
                }
            elif union == "indexFF":
                iff = full.indexFF
                ff_dict["indexFF"] = {
                    "ltpc": _ltpc_to_dict(iff.ltpc) if iff.HasField("ltpc") else {},
                    "marketOHLC": _market_ohlc_to_dict(iff.marketOHLC) if iff.HasField("marketOHLC") else {},
                }
            feed_dict["fullFeed"] = ff_dict
        elif which == "firstLevelWithGreeks":
            flg = feed.firstLevelWithGreeks
            feed_dict["firstLevelWithGreeks"] = {
                "ltpc": _ltpc_to_dict(flg.ltpc) if flg.HasField("ltpc") else {},
                "firstDepth": {
                    "bidQ": flg.firstDepth.bidQ,
                    "bidP": flg.firstDepth.bidP,
                    "askQ": flg.firstDepth.askQ,
                    "askP": flg.firstDepth.askP,
                } if flg.HasField("firstDepth") else {},
                "optionGreeks": _option_greeks_to_dict(flg.optionGreeks) if flg.HasField("optionGreeks") else {},
                "vtt": flg.vtt,
                "oi": flg.oi,
                "iv": flg.iv,
            }
            feed_dict["requestMode"] = request_mode

        result["feeds"][instrument_key] = feed_dict

    return result


class UpstoxWebsocketClient:
    def __init__(
        self,
        credential_store: Any,
        instrument_service: Any,
    ) -> None:
        self._credential_store = credential_store
        self._instrument_service = instrument_service

        self._ws: websockets.WebSocketClientProtocol | None = None
        self._task: asyncio.Task | None = None
        self._running = False
        self._reconnect_attempts = 0
        self._last_reconnect_at = 0.0

        self._subscribed_symbols: set[str] = set()
        self._inst_key_by_symbol: dict[str, str] = {}
        self._symbol_by_inst_key: dict[str, str] = {}
        self._last_cumulative_volume: dict[str, float] = {}

        self._tick_handlers: list[Callable] = []
        self._status_handlers: list[Callable] = []

        self._status: dict[str, Any] = {
            "source": "upstox",
            "status": "idle",
            "lastTickAt": None,
            "retryInMs": None,
            "error": None,
        }

    @property
    def status(self) -> dict[str, Any]:
        return dict(self._status)

    def on_tick(self, handler: Callable) -> None:
        self._tick_handlers.append(handler)

    def on_status_change(self, handler: Callable) -> None:
        self._status_handlers.append(handler)

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._reconnect_attempts = 0
        self._task = asyncio.create_task(self._run_forever())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None
        self._emit_status("offline")

    async def subscribe(self, symbols: list[str]) -> None:
        symbols = list(dict.fromkeys(s.upper().strip() for s in symbols if s.strip()))
        if not symbols:
            return
        for s in symbols:
            self._subscribed_symbols.add(s)

        if self._ws and self._status["status"] != "offline":
            await self._send_subscriptions(self._ws, symbols)

    async def unsubscribe(self, symbols: list[str]) -> None:
        symbols = [s.upper().strip() for s in symbols if s.strip()]
        for s in symbols:
            self._subscribed_symbols.discard(s)
            self._inst_key_by_symbol.pop(s, None)
            self._last_cumulative_volume.pop(s, None)

        inst_keys = [
            ik for s, ik in self._inst_key_by_symbol.items()
            if s in symbols and ik
        ]
        for ik in inst_keys:
            self._symbol_by_inst_key.pop(ik, None)

        if inst_keys and self._ws and self._status["status"] != "offline":
            await self._send_unsubscriptions(self._ws, inst_keys)

    async def _run_forever(self) -> None:
        while self._running:
            try:
                await self._connect_and_loop()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if not self._running:
                    break
                self._emit_status(
                    "degraded",
                    error=str(exc),
                    retryInMs=RECONNECT_BACKOFF_BASE_MS,
                )
                backoff = await self._wait_reconnect_backoff()
                if backoff:
                    continue
                break

    async def _connect_and_loop(self) -> None:
        uri = await self._get_authorized_ws_uri()
        if not uri:
            self._emit_status("offline", error="Failed to get authorized WebSocket URI")
            await self._wait_reconnect_backoff()
            return

        async with websockets.connect(
            uri,
            ping_interval=30,
            ping_timeout=10,
            close_timeout=5,
            max_size=2**22,
        ) as ws:
            self._ws = ws
            self._reconnect_attempts = 0
            self._emit_status("connecting")

            if self._subscribed_symbols:
                await self._send_subscriptions(ws, list(self._subscribed_symbols))

            async for message in ws:
                if not self._running:
                    break
                if isinstance(message, bytes):
                    try:
                        await self._handle_protobuf_message(message)
                    except Exception as exc:
                        self._emit_status(
                            "degraded",
                            error=f"Message decode error: {exc}",
                        )
                elif isinstance(message, str):
                    try:
                        parsed = json.loads(message)
                        msg_type = parsed.get("type")
                        if msg_type == "market_info":
                            self._emit_status("live")
                    except (json.JSONDecodeError, ValueError):
                        pass

    async def _get_authorized_ws_uri(self) -> str | None:
        token = await self._credential_store.resolve_access_token(
            "upstox", settings.UPSTOX_ACCESS_TOKEN
        )
        if not token:
            return None

        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.get(
                    AUTHORIZE_URL,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "*/*",
                    },
                )
                if response.is_redirect:
                    location = response.headers.get("Location")
                    if location:
                        return location

                if response.status_code == 200:
                    body = response.json()
                    data = body.get("data") or body
                    uri = data.get("authorized_redirect_uri")
                    if uri:
                        return uri

                self._emit_status(
                    "offline",
                    error=f"Authorization failed: {response.status_code}",
                )
                return None
        except httpx.RequestError as exc:
            self._emit_status("offline", error=f"Auth request failed: {exc}")
            return None

    async def _send_subscriptions(self, ws: websockets.WebSocketClientProtocol, symbols: list[str]) -> None:
        records = await self._instrument_service.get_by_symbols(symbols)
        if not records:
            return

        inst_keys = []
        for rec in records:
            symbol = rec["symbol"]
            inst_key = rec["instrument_key"]
            self._inst_key_by_symbol[symbol] = inst_key
            self._symbol_by_inst_key[inst_key] = symbol
            inst_keys.append(inst_key)

        for offset in range(0, len(inst_keys), SUBSCRIBE_BATCH_SIZE):
            batch = inst_keys[offset:offset + SUBSCRIBE_BATCH_SIZE]
            payload = {
                "guid": secrets.token_hex(12),
                "method": "sub",
                "data": {
                    "mode": "full",
                    "instrumentKeys": batch,
                },
            }
            await ws.send(json.dumps(payload).encode("utf-8"))

    async def _send_unsubscriptions(self, ws: websockets.WebSocketClientProtocol, inst_keys: list[str]) -> None:
        for offset in range(0, len(inst_keys), SUBSCRIBE_BATCH_SIZE):
            batch = inst_keys[offset:offset + SUBSCRIBE_BATCH_SIZE]
            payload = {
                "guid": secrets.token_hex(12),
                "method": "unsub",
                "data": {
                    "instrumentKeys": batch,
                },
            }
            await ws.send(json.dumps(payload).encode("utf-8"))

    async def _handle_protobuf_message(self, buffer: bytes) -> None:
        decoded = _decode_feed_response(buffer)
        msg_type = decoded.get("type")

        if msg_type == "market_info":
            self._emit_status("live")
            return

        if msg_type != "live_feed":
            return

        feeds = decoded.get("feeds", {})
        current_ts = decoded.get("currentTs", 0) or int(time.time() * 1000)

        for instrument_key, feed in feeds.items():
            symbol = self._symbol_by_inst_key.get(instrument_key, instrument_key)

            if "fullFeed" in feed:
                tick = self._process_full_feed(symbol, instrument_key, feed, current_ts)
            elif "ltpc" in feed:
                tick = self._process_ltpc_feed(symbol, instrument_key, feed, current_ts)
            else:
                continue

            if tick is None:
                continue

            self._emit_status("live", lastTickAt=tick["recorded_at"])

            for handler in self._tick_handlers:
                try:
                    handler(tick)
                except Exception:
                    pass

    def _process_full_feed(self, symbol: str, instrument_key: str, feed: dict, recorded_at: int) -> dict | None:
        quote_patch = _build_quote_patch(symbol, instrument_key, feed, recorded_at)
        price = quote_patch.get("lastPrice")
        if price is None:
            return None

        market_ff = feed.get("fullFeed", {}).get("marketFF", {})
        cumulative_volume = market_ff.get("vtt")
        volume = self._to_volume_delta(symbol, cumulative_volume)
        ltpc = market_ff.get("ltpc") or {}

        return {
            "symbol": symbol,
            "price": float(price),
            "recorded_at": recorded_at,
            "volume": volume,
            "cum_volume": float(cumulative_volume) if cumulative_volume is not None else 0.0,
            "last_trade_qty": _parse_int(ltpc.get("ltq")) or 0,
            "oi": _parse_number(market_ff.get("oi")) or 0.0,
            "iv": _parse_number(market_ff.get("iv")) or 0.0,
            "quote": quote_patch,
            "payload": feed,
        }

    def _process_ltpc_feed(self, symbol: str, instrument_key: str, feed: dict, recorded_at: int) -> dict | None:
        ltpc = feed.get("ltpc", {})
        price = _parse_number(ltpc.get("ltp"))
        if price is None:
            return None

        return {
            "symbol": symbol,
            "price": float(price),
            "recorded_at": recorded_at,
            "volume": _parse_int(ltpc.get("ltq")),
            "quote": {
                "symbol": symbol,
                "instrumentKey": instrument_key,
                "lastPrice": float(price),
                "close": _parse_number(ltpc.get("cp")),
                "lastTradeTime": str(ltpc.get("ltt")) if ltpc.get("ltt") else None,
                "timestamp": datetime.fromtimestamp(recorded_at / 1000, tz=UTC).isoformat(),
            },
            "payload": feed,
        }

    def _to_volume_delta(self, symbol: str, cumulative_volume: Any) -> int | None:
        cv = _parse_number(cumulative_volume)
        if cv is None or cv < 0:
            return None

        prev = self._last_cumulative_volume.get(symbol)

        if prev is None:
            self._last_cumulative_volume[symbol] = cv
            return 0

        if cv < prev:
            self._last_cumulative_volume[symbol] = cv
            return None

        delta = int(cv - prev)
        self._last_cumulative_volume[symbol] = cv
        return delta

    async def _wait_reconnect_backoff(self) -> bool:
        if not self._running:
            return False

        self._reconnect_attempts += 1
        backoff_ms = min(
            RECONNECT_BACKOFF_BASE_MS * (2 ** min(self._reconnect_attempts - 1, 5)),
            RECONNECT_BACKOFF_MAX_MS,
        )
        self._last_reconnect_at = time.time()
        self._emit_status("connecting", retryInMs=int(backoff_ms))

        await asyncio.sleep(backoff_ms / 1000)
        return True

    def _emit_status(self, status: str, **kwargs: Any) -> None:
        self._status["status"] = status
        for k, v in kwargs.items():
            if v is not None:
                self._status[k] = v
        for handler in self._status_handlers:
            try:
                handler(dict(self._status))
            except Exception:
                pass
