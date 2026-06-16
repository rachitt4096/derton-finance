"""Multi-horizon XGBoost inference.

On each new feature event, loads the live model per horizon (cached in-process),
predicts calibrated P(up), estimates expected move, runs SHAP, and writes:
  * Redis pred:{horizon}:{symbol}          (live, for scanner/API)
  * ClickHouse predictions.prediction_{h}  (durable)
  * ClickHouse predictions.shap_contributions
  * stream:preds.new                       (-> scanner)

Models + calibrators are loaded from MinIO via the registry. Active version per
horizon comes from Redis key model:active:{horizon} (set by training).
"""
from __future__ import annotations

import asyncio
import time

import numpy as np

from services.common.clickhouse import BatchInserter
from services.common.config import settings
from services.common.redis_bus import ack, consume, redis, xadd
from services.inference.explain import top_contributions

PRED_COLS = ["timestamp", "symbol", "probability_up", "probability_down",
             "confidence", "expected_move", "model_version", "feature_version"]
SHAP_COLS = ["timestamp", "symbol", "horizon", "model_version", "base_value",
             "feature_contributions", "top_positive_features",
             "top_negative_features"]

FEATURE_ORDER = [  # must match training
    "rsi_14", "ema_9", "ema_20", "ema_50", "ema_200", "macd", "macd_signal",
    "macd_hist", "atr", "bollinger_width", "volume_ratio", "vwap_distance",
    "return_1", "return_3", "return_5", "return_10", "sector_strength",
    "market_strength", "relative_strength", "volatility_rank", "liquidity_rank",
]


class Predictor:
    def __init__(self):
        self.inserter = BatchInserter()
        self.models: dict[str, "LoadedModel"] = {}   # horizon -> model bundle

    async def run(self, consumer="infer-1"):
        await self._load_all()
        async for msg_id, ev in consume("stream:features.1m", "cg:inference", consumer):
            await self._predict(ev["symbol"], int(float(ev["timestamp"])))
            await ack("stream:features.1m", "cg:inference", msg_id)

    async def _load_all(self):
        from services.training.registry import load_active
        for h in settings.horizons:
            self.models[h] = load_active(h)

    async def _predict(self, symbol: str, ts: int):
        feat = await redis().hgetall(f"feat:{symbol}")
        if not feat:
            return
        x = np.array([[float(feat.get(k, 0.0)) for k in FEATURE_ORDER]])

        for h, m in self.models.items():
            raw = float(m.booster.predict(m.to_dmatrix(x))[0])
            p_up = float(m.calibrator.transform([raw])[0]) if m.calibrator else raw
            conf = abs(2 * p_up - 1) * m.sharpness
            exp_move = float(m.move_head.predict(m.to_dmatrix(x))[0]) if m.move_head else 0.0

            # persist + cache
            row = [ts, symbol, p_up, 1 - p_up, conf, exp_move,
                   m.version, settings.feature_version]
            self.inserter.insert(f"predictions.prediction_{h}", PRED_COLS, row)

            await redis().hset(f"pred:{h}:{symbol}", mapping={
                "p_up": p_up, "conf": conf, "exp_move": exp_move,
                "model_version": m.version, "ts": ts})
            await redis().expire(f"pred:{h}:{symbol}", _ttl(h))

            # SHAP — cheap for one row on a tree model
            base, contribs = m.shap(x, FEATURE_ORDER)
            pos, neg = top_contributions(contribs)
            self.inserter.insert("predictions.shap_contributions", SHAP_COLS, [
                ts, symbol, h, m.version, base, contribs, pos, neg])

            await xadd("stream:preds.new", {"symbol": symbol, "horizon": h,
                                            "p_up": p_up, "conf": conf,
                                            "exp_move": exp_move}, maxlen=500_000)


def _ttl(h: str) -> int:
    return {"30s": 30, "2m": 120, "15m": 900, "eod": 86_400}[h]


# Lightweight bundle returned by the registry loader; see training/registry.py.
class LoadedModel:
    def __init__(self, version, booster, calibrator, move_head, sharpness, explainer):
        self.version = version
        self.booster = booster
        self.calibrator = calibrator
        self.move_head = move_head
        self.sharpness = sharpness
        self._explainer = explainer

    def to_dmatrix(self, x):
        import xgboost as xgb
        return xgb.DMatrix(x, feature_names=FEATURE_ORDER)

    def shap(self, x, names):
        vals = self._explainer.shap_values(x)[0]
        return float(self._explainer.expected_value), \
            {n: float(v) for n, v in zip(names, vals)}


if __name__ == "__main__":
    asyncio.run(Predictor().run())
