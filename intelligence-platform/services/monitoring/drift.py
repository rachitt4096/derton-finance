"""Continuous-learning monitor: data/feature/accuracy/calibration drift.

Runs nightly (Celery beat). Reads the live feature distribution and realized
outcomes from ClickHouse, compares to the active model's training baseline
(feature_registry + backtest metrics), writes analytics.model_monitoring, and
emits stream:alerts (+ optional auto-retrain trigger) on threshold breaches.
"""
from __future__ import annotations

from datetime import date

import numpy as np

from services.common.clickhouse import get_client
from services.common.config import settings
from services.common.redis_bus import xadd

MON_COLS = ["eval_date", "model_version", "horizon", "metric_type", "feature",
            "value", "baseline", "threshold", "breached", "detail"]


def psi(expected: np.ndarray, actual: np.ndarray, bins=10) -> float:
    """Population Stability Index between two distributions."""
    edges = np.quantile(expected, np.linspace(0, 1, bins + 1))
    edges[0], edges[-1] = -np.inf, np.inf
    e = np.histogram(expected, edges)[0] / len(expected) + 1e-6
    a = np.histogram(actual, edges)[0] / len(actual) + 1e-6
    return float(np.sum((a - e) * np.log(a / e)))


async def run_monitor():
    ch = get_client()
    rows: list[list] = []
    today = date.today()

    for horizon in settings.horizons:
        mv = _active_version(ch, horizon)
        if not mv:
            continue

        # ---- feature drift (PSI per feature vs training baseline) ----
        live = ch.query_df(
            "SELECT * FROM features.features_1m "
            "WHERE timestamp >= today() - 1 LIMIT 200000")
        for feat in _numeric_feats(live):
            base = ch.query(
                f"SELECT train_p01, train_p99, train_mean, train_std "
                f"FROM features.feature_registry FINAL "
                f"WHERE feature_version='{settings.feature_version}' AND name='{feat}'"
            ).result_rows
            if not base:
                continue
            # synthesize baseline sample from stored moments for PSI proxy
            mean, std = base[0][2], base[0][3]
            baseline = np.random.normal(mean, std + 1e-9, 5000)
            val = psi(baseline, live[feat].dropna().values)
            breached = val > settings.psi_threshold
            rows.append([today, mv, horizon, "feature_drift", feat, val,
                         0.0, settings.psi_threshold, int(breached), ""])
            if breached:
                await _alert(f"feature_drift {feat} h={horizon} psi={val:.3f}")

        # ---- accuracy degradation ----
        acc = ch.query(
            f"SELECT avg(correct) FROM predictions.outcomes "
            f"WHERE horizon='{horizon}' AND model_version='{mv}' "
            f"AND timestamp >= today() - 7").result_rows[0][0] or 0.0
        baseline_acc = ch.query(
            f"SELECT val_accuracy FROM predictions.model_registry FINAL "
            f"WHERE model_version='{mv}' AND horizon='{horizon}'").result_rows
        base_acc = baseline_acc[0][0] if baseline_acc else 0.5
        drop = base_acc - acc
        breached = drop > settings.accuracy_drop_threshold
        rows.append([today, mv, horizon, "accuracy", "", acc, base_acc,
                     settings.accuracy_drop_threshold, int(breached), ""])
        if breached:
            await _alert(f"accuracy_drop h={horizon} {base_acc:.3f}->{acc:.3f}")

        # ---- calibration degradation (rolling ECE) ----
        ece = _rolling_ece(ch, horizon, mv)
        breached = ece > settings.ece_threshold
        rows.append([today, mv, horizon, "calibration", "", ece, 0.0,
                     settings.ece_threshold, int(breached), ""])
        if breached:
            await _alert(f"calibration_drift h={horizon} ece={ece:.3f}")

    if rows:
        ch.insert("analytics.model_monitoring", rows, column_names=MON_COLS)


def _numeric_feats(df):
    skip = {"timestamp", "symbol", "feature_version", "computed_at"}
    return [c for c in df.columns if c not in skip]


def _active_version(ch, horizon):
    r = ch.query(f"SELECT model_version FROM predictions.model_registry FINAL "
                 f"WHERE horizon='{horizon}' AND is_active=1 LIMIT 1").result_rows
    return r[0][0] if r else None


def _rolling_ece(ch, horizon, mv, bins=10):
    df = ch.query_df(
        f"SELECT probability_up AS p, realized_up AS y FROM predictions.outcomes "
        f"WHERE horizon='{horizon}' AND model_version='{mv}' "
        f"AND timestamp >= today() - 7")
    if df.empty:
        return 0.0
    p, y = df["p"].values, df["y"].values
    edges = np.linspace(0, 1, bins + 1)
    ece = 0.0
    for i in range(bins):
        m = (p >= edges[i]) & (p < edges[i + 1])
        if m.sum():
            ece += m.mean() * abs(y[m].mean() - p[m].mean())
    return float(ece)


async def _alert(msg: str):
    await xadd("stream:alerts", {"type": "drift", "message": msg}, maxlen=100_000)
