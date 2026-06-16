"""Regime classifier + strategy detector (deterministic, descriptive).

Both run on each closed 1m feature update (sourced from stream:features.1m).
They are rule-based on top of features so their output is always explainable
and never "predicts" — they label the current observed market state only.

Outputs:
  * ClickHouse analytics.regime_classifications / analytics.strategy_scores
  * Redis  regime:{symbol}   (string "Regime:confidence")
           strat:{symbol}    (hash  strategy->score)

Run one instance (or multiple in cg:regime consumer group).
"""
from __future__ import annotations

import asyncio

from services.common.clickhouse import BatchInserter
from services.common.redis_bus import ack, consume, redis

REGIME_COLS = ["timestamp", "symbol", "regime", "confidence", "timeframe"]
STRAT_COLS  = ["timestamp", "symbol", "strategy", "score", "timeframe"]


def classify_regime(f: dict) -> tuple[str, float]:
    """Return (regime, confidence) from the feature dict."""
    ema_stack_up = f["ema_9"] > f["ema_20"] > f["ema_50"]
    ema_stack_dn = f["ema_9"] < f["ema_20"] < f["ema_50"]
    vol_rank = f["volatility_rank"]
    slope = f["ema_20"] - f["ema_50"]

    if vol_rank > 0.85:
        return "HighVolatility", vol_rank
    if vol_rank < 0.15:
        return "LowVolatility", 1 - vol_rank
    if ema_stack_up and slope > 0:
        return "TrendingBull", min(1.0, abs(slope) / (f["atr"] + 1e-9))
    if ema_stack_dn and slope < 0:
        return "TrendingBear", min(1.0, abs(slope) / (f["atr"] + 1e-9))
    return "Sideways", 0.6


def score_strategies(f: dict) -> dict[str, float]:
    """Return each strategy's score in [0, 1]."""
    clamp = lambda x: max(0.0, min(1.0, float(x)))
    return {
        "Momentum": clamp(f["relative_strength"] * 5 + f["macd_hist"]),
        "Breakout": clamp(f["bollinger_width"] * (f["volume_ratio"] - 1)),
        "Pullback": (clamp(1 - abs(f["rsi_14"] - 40) / 40)
                     if f["ema_9"] > f["ema_50"] else 0.0),
        "MeanReversion": (clamp(abs(f["vwap_distance"]) * 10)
                          if abs(f["rsi_14"] - 50) > 20 else 0.0),
        "GapContinuation": clamp(f["return_1"] * 10 * (f["volume_ratio"] - 1)),
    }


class RegimeStrategyService:
    def __init__(self):
        self.inserter = BatchInserter()

    async def run(self, consumer="regime-1"):
        """Consume stream:features.1m → classify regime + score strategies."""
        async for msg_id, ev in consume("stream:features.1m", "cg:regime", consumer):
            sym = ev.get("symbol")
            ts  = ev.get("timestamp")
            if sym and ts:
                # Pull the full feature dict from Redis (event only carries sym+ts).
                r = redis()
                raw = await r.hgetall(f"feat:{sym}")
                if raw:
                    f = {k: _coerce(k, v) for k, v in raw.items()}
                    f["symbol"] = sym
                    f["timestamp"] = int(float(ts))
                    await self.on_feature(r, f)
            await ack("stream:features.1m", "cg:regime", msg_id)

    async def on_feature(self, r, f: dict, timeframe: str = "15m"):
        ts, sym = f["timestamp"], f["symbol"]
        regime, conf = classify_regime(f)
        self.inserter.insert("analytics.regime_classifications", REGIME_COLS,
                             [ts, sym, regime, conf, timeframe])
        await r.set(f"regime:{sym}", f"{regime}:{conf:.2f}", ex=1800)

        strategies = score_strategies(f)
        for strat, sc in strategies.items():
            self.inserter.insert("analytics.strategy_scores", STRAT_COLS,
                                 [ts, sym, strat, sc, "5m"])
        await r.hset(f"strat:{sym}", mapping=strategies)
        await r.expire(f"strat:{sym}", 900)


def _coerce(key: str, val: str):
    """Convert Redis string value back to float for numeric feature fields."""
    _STR_KEYS = {"symbol", "feature_version", "computed_at"}
    if key in _STR_KEYS:
        return val
    try:
        return float(val)
    except (ValueError, TypeError):
        return val


if __name__ == "__main__":
    asyncio.run(RegimeStrategyService().run())
