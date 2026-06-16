"""Upstox WebSocket V3 ingestion.

Connects to the market-data feed, decodes protobuf frames, normalizes to a flat
tick, then (a) updates Redis hot state, (b) publishes to stream:ticks.raw, and
(c) buffers into the batched ClickHouse inserter. Auto-reconnects with backoff
and tracks per-symbol gaps for the monitor.

Proto setup (one-time):
    pip install grpcio-tools
    bash scripts/gen_proto.sh

Run as a SINGLE active instance (leader-elected) — it owns the upstream socket.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import websockets

from services.common.clickhouse import BatchInserter
from services.common.config import settings
from services.common.instruments import to_symbol
from services.common.redis_bus import redis, xadd

IST = timezone(datetime.now(timezone.utc).astimezone().utcoffset() or
               __import__("datetime").timedelta(hours=5, minutes=30))

TICK_COLS = ["timestamp", "symbol", "ltp", "ltq", "volume",
             "bid_price", "ask_price", "bid_qty", "ask_qty"]


def _load_pb():
    """Try multiple import paths for the compiled protobuf module."""
    try:
        from services.ingestion import MarketDataFeed_pb2
        return MarketDataFeed_pb2
    except ImportError:
        pass
    try:
        # Upstox Python SDK ships its own compiled pb2.
        from upstox_client.feeder import MarketDataFeed_pb2  # type: ignore[import]
        return MarketDataFeed_pb2
    except ImportError:
        pass
    return None


_pb = _load_pb()


def decode_frame(raw: bytes) -> list[dict]:
    """Decode an Upstox V3 protobuf frame into normalized tick dicts.

    Each dict has the shape expected by TICK_COLS + the pipeline downstream.
    Returns an empty list for subscription-ack frames and non-LTPC feeds.

    The pb2 module must be generated first (see scripts/gen_proto.sh) OR the
    upstox-python-sdk package must be installed (it ships the compiled pb2).
    """
    if _pb is None:
        raise ImportError(
            "MarketDataFeed_pb2 not found. Run: bash scripts/gen_proto.sh\n"
            "Or: pip install upstox-python-sdk"
        )

    resp = _pb.MarketDataFeedResponse()
    resp.ParseFromString(raw)

    now_ist = datetime.now(timezone.utc).astimezone().__class__.now(
        __import__("datetime").timezone(__import__("datetime").timedelta(hours=5, minutes=30))
    ).isoformat()

    ticks: list[dict] = []
    for ikey, feed in resp.feeds.items():
        if not feed.HasField("ltpc"):
            continue  # no price data in this feed entry

        ltpc = feed.ltpc
        sym = to_symbol(ikey)

        # Depth (top-of-book from eFeedDetails).
        bid_p = ask_p = float(ltpc.ltp)
        bid_q = ask_q = 0
        vol_cum = 0

        if feed.HasField("ff"):
            ff = feed.ff
            # Top-of-book bid/ask.
            if ff.HasField("eFeedDetails"):
                ed = ff.eFeedDetails
                if ed.bp:
                    bid_p = float(ed.bp[0].price)
                    bid_q = int(ed.bp[0].quantity)
                if ed.sp:
                    ask_p = float(ed.sp[0].price)
                    ask_q = int(ed.sp[0].quantity)
            # Extended details carry vtt (volume traded today = cumulative).
            if ff.HasField("eFeedDetails2"):
                vol_cum = int(ff.eFeedDetails2.vtt)
            # OHLCV daily bar also carries cumulative volume as fallback.
            elif ff.HasField("marketOHLC"):
                for bar in ff.marketOHLC.ohlc:
                    if bar.interval == "1d":
                        vol_cum = int(bar.volume)
                        break

        # Timestamp: prefer feed ltt (epoch ms), fall back to wall-clock.
        ts_ms = int(ltpc.ltt) if ltpc.ltt else int(time.time() * 1000)
        ts_iso = datetime.fromtimestamp(
            ts_ms / 1000,
            tz=__import__("datetime").timezone(
                __import__("datetime").timedelta(hours=5, minutes=30))
        ).isoformat()

        ticks.append({
            "timestamp": ts_iso,
            "symbol": sym,
            "ltp": float(ltpc.ltp),
            "ltq": int(ltpc.ltq),
            "volume": vol_cum,
            "bid_price": bid_p,
            "ask_price": ask_p,
            "bid_qty": bid_q,
            "ask_qty": ask_q,
        })
    return ticks


class Ingestor:
    def __init__(self):
        self.inserter = BatchInserter()
        self.last_seen: dict[str, float] = {}

    async def run(self, instrument_keys: list[str]):
        backoff = 1
        while True:
            try:
                await self._stream(instrument_keys)
                backoff = 1
            except Exception as exc:  # noqa: BLE001
                print(f"[ingest] disconnected: {exc}; reconnecting in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    async def _stream(self, instrument_keys: list[str]):
        headers = {"Authorization": f"Bearer {settings.upstox_access_token}"}
        async with websockets.connect(settings.upstox_ws_url,
                                      extra_headers=headers,
                                      max_size=None) as ws:
            await ws.send(self._subscribe_msg(instrument_keys))
            async for raw in ws:
                for tick in decode_frame(raw):
                    await self._handle(tick)

    @staticmethod
    def _subscribe_msg(instrument_keys: list[str]) -> str:
        import json
        return json.dumps({"guid": "derton", "method": "sub",
                           "data": {"mode": "full", "instrumentKeys": instrument_keys}})

    async def _handle(self, t: dict):
        sym = t["symbol"]
        self.last_seen[sym] = time.time()

        # (a) hot state for the API/scanner
        await redis().hset(f"ltp:{sym}", mapping={
            "ltp": t["ltp"], "ts": t["timestamp"], "vol": t["volume"]})
        await redis().expire(f"ltp:{sym}", 86_400)
        await redis().hset(f"book:{sym}", mapping={
            "bid": t["bid_price"], "ask": t["ask_price"],
            "bid_qty": t["bid_qty"], "ask_qty": t["ask_qty"]})

        # (b) event bus -> candle builder + feature engine
        await xadd("stream:ticks.raw", t, maxlen=2_000_000)

        # (c) durable storage (batched, off hot path)
        self.inserter.insert("market_data.ticks", TICK_COLS, [
            t["timestamp"], sym, t["ltp"], t["ltq"], t["volume"],
            t["bid_price"], t["ask_price"], t["bid_qty"], t["ask_qty"]])


if __name__ == "__main__":
    from services.common.instruments import all_instrument_keys
    asyncio.run(Ingestor().run(all_instrument_keys()))
