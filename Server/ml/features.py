#!/usr/bin/env python3
"""
ml/features.py — Component 1 of the modeling pipeline.

ClickHouse candles  →  clean, leak-free feature matrix (pandas DataFrame).

Design rules:
  * Every feature is computed from PAST/CURRENT bars only — no look-ahead.
    (Labels live in ml/labels.py and are the ONLY thing allowed to peek forward.)
  * Indicators are hand-rolled (pandas/numpy only) so there's no TA-Lib dependency.
  * Same feature set works for descriptive base-rates OR a predictive head — the
    target is decided later, in labeling.

CLI preview:
  python -m ml.features --symbol RELIANCE --interval 1m
  python -m ml.features --symbol RELIANCE --interval 1s --tail 20
"""
from __future__ import annotations

import argparse
import os

import numpy as np
import pandas as pd
from clickhouse_driver import Client as CHClient


# ── ClickHouse load ───────────────────────────────────────────────────────────

def _ch() -> CHClient:
    def _env(path: str) -> dict[str, str]:
        out: dict[str, str] = {}
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        out[k.strip()] = v.strip()
        except FileNotFoundError:
            pass
        return out

    env = _env(os.path.join(os.path.dirname(__file__), "..", ".env"))
    return CHClient(
        host=env.get("CLICKHOUSE_HOST", "localhost"),
        port=int(env.get("CLICKHOUSE_PORT", "9000")),
        user=env.get("CLICKHOUSE_USER", "default"),
        password=env.get("CLICKHOUSE_PASSWORD", ""),
        database=env.get("CLICKHOUSE_DATABASE", "derton_finance"),
        settings={"max_execution_time": 120},
    )


def load_candles(symbol: str, interval: str, ch: CHClient | None = None) -> pd.DataFrame:
    """Load OHLCV(+oi) for one symbol/interval, deduped (ReplacingMergeTree) and
    sorted by time. Returns empty DataFrame if nothing is stored yet."""
    ch = ch or _ch()
    rows = ch.execute(
        """
        SELECT bucket_start, open, high, low, close, volume, oi
        FROM market_candles FINAL
        WHERE symbol = %(s)s AND interval = %(i)s
        ORDER BY bucket_start
        """,
        {"s": symbol, "i": interval},
    )
    df = pd.DataFrame(
        rows, columns=["ts", "open", "high", "low", "close", "volume", "oi"]
    )
    if df.empty:
        return df
    df["ts"] = pd.to_datetime(df["ts"])
    for c in ("open", "high", "low", "close", "volume", "oi"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.reset_index(drop=True)


# ── Indicator helpers ─────────────────────────────────────────────────────────

def _ema(s: pd.Series, span: int) -> pd.Series:
    return s.ewm(span=span, adjust=False).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    # Wilder smoothing
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _session_vwap(df: pd.DataFrame) -> pd.Series:
    """VWAP that resets each trading day."""
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    pv = tp * df["volume"].fillna(0)
    day = df["ts"].dt.date
    cum_pv = pv.groupby(day).cumsum()
    cum_v = df["volume"].fillna(0).groupby(day).cumsum().replace(0, np.nan)
    return cum_pv / cum_v


# ── Feature blocks ──────────────────────────────────────────────────────────────

def _returns(df: pd.DataFrame, lags=(1, 3, 5, 10, 30, 60)) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    logret = np.log(df["close"] / df["close"].shift(1))
    out["ret_1"] = logret
    for n in lags:
        out[f"ret_{n}"] = np.log(df["close"] / df["close"].shift(n))
    # acceleration: short vs longer momentum
    out["accel_5_30"] = out["ret_5"] - out["ret_30"]
    return out


def _trend(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    close = df["close"]
    for span in (9, 21, 50):
        ema = _ema(close, span)
        out[f"ema_{span}_dist"] = (close - ema) / ema  # % distance, scale-free
    out["ema_9_21_spread"] = (_ema(close, 9) - _ema(close, 21)) / _ema(close, 21)
    return out


def _momentum(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    out["rsi_14"] = _rsi(df["close"], 14)
    # Stochastic %K over 14 bars
    low14 = df["low"].rolling(14).min()
    high14 = df["high"].rolling(14).max()
    out["stoch_k"] = ((df["close"] - low14) / (high14 - low14).replace(0, np.nan)) * 100
    return out


def _volatility(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    logret = np.log(df["close"] / df["close"].shift(1))
    out["realized_vol_10"] = logret.rolling(10).std()
    out["realized_vol_60"] = logret.rolling(60).std()
    atr = _atr(df, 14)
    out["atr_pct"] = atr / df["close"]              # ATR normalized by price
    out["range_pct"] = (df["high"] - df["low"]) / df["close"]
    return out


def _volume(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    vol = df["volume"].fillna(0)
    rolling_mean = vol.rolling(20).mean()
    rolling_std = vol.rolling(20).std().replace(0, np.nan)
    out["rel_volume_20"] = vol / rolling_mean.replace(0, np.nan)   # 1 = average
    out["volume_z_20"] = (vol - rolling_mean) / rolling_std
    out["vol_delta_5"] = vol - vol.shift(5)
    return out


def _vwap(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    vwap = _session_vwap(df)
    out["vwap_dist"] = (df["close"] - vwap) / vwap   # % from session VWAP
    return out


def _time(df: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    ts = df["ts"]
    minute_of_day = ts.dt.hour * 60 + ts.dt.minute
    # cyclical encoding over the trading window (9:15=555 → 15:30=930)
    frac = ((minute_of_day - 555) / (930 - 555)).clip(0, 1)
    out["tod_sin"] = np.sin(2 * np.pi * frac)
    out["tod_cos"] = np.cos(2 * np.pi * frac)
    out["dow"] = ts.dt.dayofweek
    out["is_opening_30m"] = (minute_of_day < 555 + 30).astype("int8")
    out["is_power_hour"] = (minute_of_day >= 870).astype("int8")  # 14:30+
    return out


# ── Orchestrator ─────────────────────────────────────────────────────────────

# Intraday-only feature blocks (skip session VWAP / time-of-day for daily bars).
def build_features(symbol: str, interval: str, ch: CHClient | None = None) -> pd.DataFrame:
    df = load_candles(symbol, interval, ch)
    if df.empty:
        return df

    blocks = [_returns(df), _trend(df), _momentum(df), _volatility(df), _volume(df)]
    if interval != "1d":
        blocks += [_vwap(df), _time(df)]

    feats = pd.concat([df[["ts", "close", "volume", "oi"]], *blocks], axis=1)
    feats.insert(0, "symbol", symbol)
    feats.insert(1, "interval", interval)

    # clean: drop warm-up rows where long-window features are still NaN
    feats = feats.replace([np.inf, -np.inf], np.nan)
    return feats.reset_index(drop=True)


def feature_columns(feats: pd.DataFrame) -> list[str]:
    """The model-input columns (everything except identifiers / raw passthrough)."""
    skip = {"symbol", "interval", "ts", "close", "volume", "oi"}
    return [c for c in feats.columns if c not in skip]


# ── CLI ─────────────────────────────────────────────────────────────────────────

def main() -> None:
    p = argparse.ArgumentParser(description="Preview the feature matrix")
    p.add_argument("--symbol", required=True)
    p.add_argument("--interval", default="1m")
    p.add_argument("--tail", type=int, default=8)
    args = p.parse_args()

    feats = build_features(args.symbol, args.interval)
    if feats.empty:
        print(f"No candles stored for {args.symbol} {args.interval}")
        return

    cols = feature_columns(feats)
    valid = feats.dropna(subset=cols)
    print(f"{args.symbol} {args.interval}: {len(feats):,} bars, "
          f"{len(cols)} features, {len(valid):,} usable after warm-up")
    print(f"Range: {feats['ts'].min()} → {feats['ts'].max()}\n")
    print("Feature columns:")
    print("  " + ", ".join(cols))
    print(f"\nLast {args.tail} rows (close + key features):")
    show = ["ts", "close", "ret_1", "ema_9_21_spread", "rsi_14",
            "atr_pct", "rel_volume_20"]
    show = [c for c in show if c in feats.columns]
    with pd.option_context("display.max_columns", None, "display.width", 200):
        print(valid[show].tail(args.tail).to_string(index=False))


if __name__ == "__main__":
    main()
