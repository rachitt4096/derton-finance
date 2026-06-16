"""Train one calibrated XGBoost classifier per horizon + an expected-move head.

Pipeline per horizon:
  1. build point-in-time dataset (dataset.build_dataset)
  2. time-ordered train/val split (NO shuffle — avoids leakage)
  3. fit XGBClassifier (direction) + XGBRegressor on |return| (expected move)
  4. calibrate probabilities: Isotonic if val>=5k else sigmoid (Platt)
  5. evaluate AUC/accuracy/ECE, register model + calibrator to MinIO + CH registry
"""
from __future__ import annotations

import numpy as np
from sklearn.calibration import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score

from services.common.config import settings
from services.training.dataset import build_dataset
from services.training.registry import save_model

FEATURES = [
    "rsi_14", "ema_9", "ema_20", "ema_50", "ema_200", "macd", "macd_signal",
    "macd_hist", "atr", "bollinger_width", "volume_ratio", "vwap_distance",
    "return_1", "return_3", "return_5", "return_10", "sector_strength",
    "market_strength", "relative_strength", "volatility_rank", "liquidity_rank",
]


def expected_calibration_error(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1])
        if m.sum() == 0:
            continue
        ece += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(ece)


def train_horizon(horizon: str, start: str, end: str, version: str):
    import xgboost as xgb

    df = build_dataset(horizon, start, end).dropna(subset=FEATURES + ["label"])
    df = df.sort_values("timestamp")
    split = int(len(df) * 0.8)
    tr, va = df.iloc[:split], df.iloc[split:]
    Xtr, ytr = tr[FEATURES].values, tr["label"].values
    Xva, yva = va[FEATURES].values, va["label"].values

    clf = xgb.XGBClassifier(
        n_estimators=600, max_depth=6, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8, eval_metric="auc",
        tree_method="hist", n_jobs=-1)
    clf.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)

    # expected-move head on |forward return|
    reg = xgb.XGBRegressor(n_estimators=400, max_depth=5, learning_rate=0.03,
                           subsample=0.8, tree_method="hist", n_jobs=-1)
    reg.fit(Xtr, np.abs(tr["fwd_return"].values))

    raw = clf.predict_proba(Xva)[:, 1]
    if len(va) >= 5000:
        cal = IsotonicRegression(out_of_bounds="clip").fit(raw, yva)
        cal_kind, p_cal = "isotonic", cal.transform(raw)
    else:
        lr = LogisticRegression().fit(raw.reshape(-1, 1), yva)
        cal = lr
        cal_kind = "platt"
        p_cal = lr.predict_proba(raw.reshape(-1, 1))[:, 1]

    metrics = {
        "val_auc": roc_auc_score(yva, p_cal),
        "val_accuracy": accuracy_score(yva, (p_cal > 0.5).astype(int)),
        "val_ece": expected_calibration_error(yva, p_cal),
        "n_samples": int(len(df)),
    }
    save_model(horizon=horizon, version=version, booster=clf.get_booster(),
               calibrator=cal, calibrator_kind=cal_kind, move_head=reg.get_booster(),
               features=FEATURES, metrics=metrics, train_start=start, train_end=end)
    print(f"[train] {horizon} {version}: {metrics}")
    return metrics


def train_all(start: str, end: str, version: str):
    for h in settings.horizons:
        train_horizon(h, start, end, version)


if __name__ == "__main__":
    import sys
    train_all(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "v1")
