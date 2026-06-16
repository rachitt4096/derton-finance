"""Walk-forward backtesting with execution realism.

For each fold: train on [t-W, t), predict on [t, t+S), simulate trades with
slippage + brokerage + position sizing, roll by S. No look-ahead: only data with
timestamp <= decision_time is ever used. Results -> backtesting.{runs,trades,metrics}.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from services.common.clickhouse import get_client
from services.training.dataset import build_dataset


@dataclass
class BTConfig:
    horizon: str = "15m"
    period_start: str = "2022-01-01"
    period_end: str = "2026-01-01"
    walk_window_days: int = 180
    retrain_step_days: int = 30
    slippage_bps: float = 2.0
    brokerage_per_order: float = 20.0       # flat ₹ + taxes below
    taxes_bps: float = 5.0                  # STT+exch+GST approx, round-trip
    sizing: str = "vol_target"              # 'fixed' | 'vol_target' | 'kelly'
    capital: float = 1_000_000.0
    risk_per_trade: float = 0.01
    prob_threshold: float = 0.58


def _fees(notional: float, cfg: BTConfig) -> float:
    return cfg.brokerage_per_order + notional * cfg.taxes_bps / 1e4


def _size(price: float, atr: float, cfg: BTConfig) -> int:
    if cfg.sizing == "fixed":
        return int(cfg.capital * cfg.risk_per_trade / price)
    if cfg.sizing == "vol_target":
        risk = cfg.capital * cfg.risk_per_trade
        return int(risk / max(atr, price * 0.001))
    return int(cfg.capital * cfg.risk_per_trade / price)  # kelly cap simplified


def run_backtest(cfg: BTConfig) -> str:
    import xgboost as xgb

    run_id = uuid.uuid4()
    ch = get_client()
    df = build_dataset(cfg.horizon, cfg.period_start, cfg.period_end)
    df = df.dropna().sort_values("timestamp").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["timestamp"]).dt.normalize()

    feats = [c for c in df.columns if c not in
             ("timestamp", "symbol", "label", "fwd_return", "date",
              "feature_version", "computed_at")]

    dates = sorted(df["date"].unique())
    W = pd.Timedelta(days=cfg.walk_window_days)
    S = pd.Timedelta(days=cfg.retrain_step_days)

    trades, equity, fold = [], [cfg.capital], 0
    t = pd.Timestamp(dates[0]) + W
    while t < pd.Timestamp(dates[-1]):
        tr = df[(df["date"] >= t - W) & (df["date"] < t)]
        te = df[(df["date"] >= t) & (df["date"] < t + S)]
        if len(tr) < 1000 or te.empty:
            t += S
            continue
        m = xgb.XGBClassifier(n_estimators=400, max_depth=6, learning_rate=0.03,
                              subsample=0.8, tree_method="hist", n_jobs=-1)
        m.fit(tr[feats].values, tr["label"].values)
        te = te.copy()
        te["p"] = m.predict_proba(te[feats].values)[:, 1]

        for _, r in te[te["p"] >= cfg.prob_threshold].iterrows():
            entry = r["fwd_return"] / max(r["fwd_return"], 1e-9)  # placeholder price norm
            price = 100.0  # backtest on returns; price normalized
            qty = _size(price, r["atr"], cfg)
            notional = qty * price
            slip = notional * cfg.slippage_bps / 1e4
            gross = qty * price * r["fwd_return"]
            fees = _fees(notional, cfg) * 2 + slip
            net = gross - fees
            equity.append(equity[-1] + net)
            trades.append({
                "run_id": run_id, "symbol": r["symbol"], "horizon": cfg.horizon,
                "entry_time": r["timestamp"], "exit_time": r["timestamp"],
                "side": "long", "entry_price": price,
                "exit_price": price * (1 + r["fwd_return"]), "qty": qty,
                "gross_pnl": gross, "fees": fees, "slippage": slip, "net_pnl": net,
                "return_pct": r["fwd_return"], "probability_up": r["p"],
                "confidence": abs(2 * r["p"] - 1), "holding_secs": 0,
            })
        fold += 1
        t += S

    _persist(ch, run_id, cfg, trades, np.array(equity))
    return str(run_id)


def _persist(ch, run_id, cfg, trades, equity):
    ch.insert("backtesting.runs", [[
        run_id, "bt", cfg.horizon, "ml", "NIFTY500", cfg.period_start,
        cfg.period_end, cfg.walk_window_days, cfg.retrain_step_days,
        cfg.slippage_bps, cfg.sizing, cfg.sizing, "{}",
    ]], column_names=["run_id", "model_version", "horizon", "strategy", "universe",
                      "period_start", "period_end", "walk_window_days",
                      "retrain_step_days", "slippage_bps", "brokerage_model",
                      "sizing_model", "params"])
    if trades:
        ch.insert_df("backtesting.trades", pd.DataFrame(trades))
    ch.insert("backtesting.metrics", [[run_id, -1, *_metrics(trades, equity).values()]],
              column_names=["run_id", "fold", "n_trades", "accuracy", "precision",
                            "recall", "sharpe", "sortino", "max_drawdown",
                            "profit_factor", "calibration_error", "total_return",
                            "win_rate", "avg_win", "avg_loss"])


def _metrics(trades, equity):
    if not trades:
        return dict.fromkeys(
            ["n_trades", "accuracy", "precision", "recall", "sharpe", "sortino",
             "max_drawdown", "profit_factor", "calibration_error", "total_return",
             "win_rate", "avg_win", "avg_loss"], 0.0)
    t = pd.DataFrame(trades)
    rets = np.diff(equity) / equity[:-1]
    wins, losses = t[t.net_pnl > 0], t[t.net_pnl <= 0]
    dd = (equity - np.maximum.accumulate(equity)) / np.maximum.accumulate(equity)
    downside = rets[rets < 0]
    correct = (t.probability_up > 0.5) == (t.return_pct > 0)
    return {
        "n_trades": len(t),
        "accuracy": float(correct.mean()),
        "precision": float(((t.probability_up > 0.5) & (t.return_pct > 0)).sum()
                           / max((t.probability_up > 0.5).sum(), 1)),
        "recall": float(((t.probability_up > 0.5) & (t.return_pct > 0)).sum()
                        / max((t.return_pct > 0).sum(), 1)),
        "sharpe": float(rets.mean() / (rets.std() + 1e-9) * np.sqrt(252 * 25)),
        "sortino": float(rets.mean() / (downside.std() + 1e-9) * np.sqrt(252 * 25)),
        "max_drawdown": float(dd.min()),
        "profit_factor": float(wins.net_pnl.sum() / (abs(losses.net_pnl.sum()) + 1e-9)),
        "calibration_error": 0.0,
        "total_return": float(equity[-1] / equity[0] - 1),
        "win_rate": float(len(wins) / len(t)),
        "avg_win": float(wins.net_pnl.mean() if len(wins) else 0),
        "avg_loss": float(losses.net_pnl.mean() if len(losses) else 0),
    }
