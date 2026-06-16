"""Feature engine: on each closed 1m candle, recompute the feature row.

Two-layer design:
  * Per-symbol technical features (RSI/EMA/MACD/ATR/Bollinger/returns/VWAP dist)
    are computed from a rolling in-memory window kept warm per symbol (seeded from
    ClickHouse on cold start).
  * Cross-sectional features (sector_strength, market_strength, relative_strength,
    volatility_rank, liquidity_rank) need ALL symbols at time T, so they are
    computed in a short barrier once most symbols for a minute have arrived.

Output: Redis feat:{symbol} (live) + ClickHouse features.features_1m (durable) +
stream:features.1m (-> inference).
"""
from __future__ import annotations

import asyncio
from collections import deque

import numpy as np

from services.common.clickhouse import BatchInserter
from services.common.config import settings
from services.common.redis_bus import ack, consume, redis, xadd

WINDOW = 250  # bars kept warm per symbol (enough for ema_200 + lookbacks)

FEAT_COLS = ["timestamp", "symbol", "rsi_14", "ema_9", "ema_20", "ema_50",
             "ema_200", "macd", "macd_signal", "macd_hist", "atr",
             "bollinger_width", "volatility_rank", "volume_ratio",
             "vwap_distance", "liquidity_rank", "return_1", "return_3",
             "return_5", "return_10", "sector_strength", "market_strength",
             "relative_strength", "feature_version"]


class FeatureEngine:
    def __init__(self):
        self.inserter = BatchInserter()
        self.win: dict[str, deque] = {}      # symbol -> deque of (close,high,low,vol,vwap)
        self.minute_buffer: dict[int, dict[str, dict]] = {}
        self._last_flush_minute: int = 0     # most recently flushed minute bucket

    async def run(self, consumer="features-1"):
        from services.common.instruments import sector_map as _sector_map
        smap = _sector_map()
        async for msg_id, c in consume("stream:candles.1m", "cg:features", consumer):
            await self._on_candle(c)
            await ack("stream:candles.1m", "cg:features", msg_id)
            # Flush completed minutes: any minute bucket that is at least 2
            # minutes old (gives all symbols time to arrive before cross-
            # sectional ranks are computed).
            now_minute = int(__import__("time").time() // 60)
            for stale_min in sorted(self.minute_buffer):
                if stale_min < now_minute - 1 and stale_min > self._last_flush_minute:
                    await self.flush_minute(stale_min, smap)
                    self._last_flush_minute = stale_min

    async def _on_candle(self, c: dict):
        sym = c["symbol"]
        w = self.win.setdefault(sym, deque(maxlen=WINDOW))
        w.append((float(c["close"]), float(c["high"]), float(c["low"]),
                  float(c["volume"]), float(c["vwap"])))
        if len(w) < 30:
            return  # warm-up
        feats = self._technical(sym, w)
        feats["timestamp"] = int(float(c["timestamp"]))
        feats["symbol"] = sym
        # stash for the cross-sectional barrier
        self.minute_buffer.setdefault(feats["timestamp"], {})[sym] = feats

    def _technical(self, sym: str, w: deque) -> dict:
        close = np.fromiter((x[0] for x in w), float)
        high = np.fromiter((x[1] for x in w), float)
        low = np.fromiter((x[2] for x in w), float)
        vol = np.fromiter((x[3] for x in w), float)
        vwap = w[-1][4]

        ema = lambda n: _ema(close, n)
        macd = ema(12) - ema(26)
        macd_sig = _ema(_macd_series(close), 9)
        return {
            "rsi_14": _rsi(close, 14),
            "ema_9": ema(9), "ema_20": ema(20), "ema_50": ema(50), "ema_200": ema(200),
            "macd": macd, "macd_signal": macd_sig, "macd_hist": macd - macd_sig,
            "atr": _atr(high, low, close, 14),
            "bollinger_width": _bb_width(close, 20),
            "volume_ratio": vol[-1] / (vol[-20:].mean() + 1e-9),
            "vwap_distance": (close[-1] - vwap) / (vwap + 1e-9),
            "return_1": _ret(close, 1), "return_3": _ret(close, 3),
            "return_5": _ret(close, 5), "return_10": _ret(close, 10),
            # cross-sectional placeholders, filled in the barrier:
            "volatility_rank": 0.0, "liquidity_rank": 0.0,
            "sector_strength": 0.0, "market_strength": 0.0, "relative_strength": 0.0,
            "feature_version": settings.feature_version,
        }

    async def flush_minute(self, minute_ts: int, sector_map: dict[str, str]):
        """Compute cross-sectional ranks for a completed minute and persist all."""
        rows = self.minute_buffer.pop(minute_ts, {})
        if not rows:
            return
        rets = {s: f["return_1"] for s, f in rows.items()}
        vols = {s: f["volume_ratio"] for s, f in rows.items()}
        atrs = {s: f["atr"] for s, f in rows.items()}
        market = float(np.mean(list(rets.values())))
        vrank = _rank(atrs)
        lrank = _rank(vols)
        # sector strength = mean return of the symbol's sector
        sector_ret: dict[str, list[float]] = {}
        for s, r in rets.items():
            sector_ret.setdefault(sector_map.get(s, "NA"), []).append(r)
        sector_mean = {k: float(np.mean(v)) for k, v in sector_ret.items()}

        for s, f in rows.items():
            f["market_strength"] = market
            f["sector_strength"] = sector_mean.get(sector_map.get(s, "NA"), 0.0)
            f["relative_strength"] = f["return_1"] - market
            f["volatility_rank"] = vrank[s]
            f["liquidity_rank"] = lrank[s]
            await self._persist(f)

    async def _persist(self, f: dict):
        row = [f[c] for c in FEAT_COLS]
        self.inserter.insert("features.features_1m", FEAT_COLS, row)
        await redis().hset(f"feat:{f['symbol']}", mapping={
            k: v for k, v in f.items() if k not in ("symbol",)})
        await redis().expire(f"feat:{f['symbol']}", 300)
        await xadd("stream:features.1m", {"symbol": f["symbol"],
                                          "timestamp": f["timestamp"]},
                   maxlen=500_000)


# ----- vectorized indicator helpers -----
def _ema(x: np.ndarray, n: int) -> float:
    k = 2 / (n + 1)
    e = x[0]
    for v in x[1:]:
        e = v * k + e * (1 - k)
    return float(e)


def _macd_series(x: np.ndarray) -> np.ndarray:
    return np.array([_ema(x[:i + 1], 12) - _ema(x[:i + 1], 26)
                     for i in range(max(0, len(x) - 9), len(x))])


def _rsi(x: np.ndarray, n: int) -> float:
    d = np.diff(x[-(n + 1):])
    up = d[d > 0].sum() / n
    dn = -d[d < 0].sum() / n
    rs = up / (dn + 1e-9)
    return float(100 - 100 / (1 + rs))


def _atr(h, l, c, n: int) -> float:
    tr = np.maximum(h[-n:] - l[-n:],
                    np.maximum(abs(h[-n:] - c[-n - 1:-1]), abs(l[-n:] - c[-n - 1:-1])))
    return float(tr.mean())


def _bb_width(x: np.ndarray, n: int) -> float:
    w = x[-n:]
    return float(4 * w.std() / (w.mean() + 1e-9))


def _ret(x: np.ndarray, n: int) -> float:
    return float(x[-1] / x[-1 - n] - 1) if len(x) > n else 0.0


def _rank(d: dict[str, float]) -> dict[str, float]:
    if not d:
        return {}
    items = sorted(d.items(), key=lambda kv: kv[1])
    n = len(items)
    return {k: i / max(n - 1, 1) for i, (k, _) in enumerate(items)}


if __name__ == "__main__":
    asyncio.run(FeatureEngine().run())
