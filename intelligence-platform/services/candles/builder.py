"""Tick -> 1m candle builder (event-time, late-tick tolerant).

This is the live path that emits closed 1m candles to stream:candles.1m and to
ClickHouse candles_1m. (ClickHouse ALSO derives candles via the mv_ticks_to_1m
materialized view — this service exists so the *live* pipeline gets a closed
candle the instant a minute rolls, without waiting on CH merges. The two agree
because both use the same OHLCV definition.)

Scales horizontally: many instances in consumer group cg:candles, partitioned
by Redis.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from services.common.clickhouse import BatchInserter
from services.common.redis_bus import ack, consume, redis, xadd

CANDLE_COLS = ["timestamp", "symbol", "open", "high", "low", "close",
               "volume", "trades", "vwap"]


@dataclass
class Bar:
    minute: int           # epoch minute (bucket key)
    open: float
    high: float
    low: float
    close: float
    vol_first: int        # first cumulative feed-volume seen in the bucket
    vol_last: int
    pv: float = 0.0       # sum(ltp*ltq) for vwap
    qty: int = 0
    trades: int = 0


class CandleBuilder:
    def __init__(self):
        self.inserter = BatchInserter()
        self.open_bars: dict[str, Bar] = {}

    async def run(self, consumer="candles-1"):
        async for msg_id, t in consume("stream:ticks.raw", "cg:candles", consumer):
            await self._on_tick(t)
            await ack("stream:ticks.raw", "cg:candles", msg_id)

    async def _on_tick(self, t: dict):
        sym = t["symbol"]
        ts = float(t["ts"]) if "ts" in t else _epoch(t["timestamp"])
        minute = int(ts // 60)
        ltp = float(t["ltp"])
        vol = int(float(t.get("vol", t.get("volume", 0))))
        ltq = int(float(t.get("ltq", 0)))

        bar = self.open_bars.get(sym)
        if bar is None:
            self.open_bars[sym] = _new_bar(minute, ltp, vol, ltq)
            return
        if minute > bar.minute:
            await self._close(sym, bar)
            self.open_bars[sym] = _new_bar(minute, ltp, vol, ltq)
            return
        # same bucket: update
        bar.high = max(bar.high, ltp)
        bar.low = min(bar.low, ltp)
        bar.close = ltp
        bar.vol_last = vol
        bar.pv += ltp * ltq
        bar.qty += ltq
        bar.trades += 1

    async def _close(self, sym: str, bar: Bar):
        volume = max(bar.vol_last - bar.vol_first, 0)
        vwap = bar.pv / bar.qty if bar.qty else bar.close
        bucket_ts = bar.minute * 60
        row = [bucket_ts, sym, bar.open, bar.high, bar.low, bar.close,
               volume, bar.trades, vwap]
        self.inserter.insert("market_data.candles_1m", CANDLE_COLS, row)
        await xadd("stream:candles.1m", {
            "timestamp": bucket_ts, "symbol": sym, "open": bar.open,
            "high": bar.high, "low": bar.low, "close": bar.close,
            "volume": volume, "vwap": vwap}, maxlen=500_000)


def _new_bar(minute, ltp, vol, ltq) -> Bar:
    return Bar(minute=minute, open=ltp, high=ltp, low=ltp, close=ltp,
               vol_first=vol, vol_last=vol, pv=ltp * ltq, qty=ltq, trades=1)


def _epoch(iso: str) -> float:
    from datetime import datetime
    return datetime.fromisoformat(iso).timestamp()


if __name__ == "__main__":
    asyncio.run(CandleBuilder().run())
