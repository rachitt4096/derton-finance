"""FastAPI read API — serves the scanner, predictions, narration, and health.

Hot reads come from Redis (sub-5ms); historical/explanatory reads hit ClickHouse.
The narration endpoint is DESCRIPTIVE: it phrases the deterministic signal facts
(SHAP drivers + regime + strategy + observed move) — it never advises or predicts
beyond the calibrated probability the model already produced.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException

from services.common.clickhouse import get_client
from services.common.redis_bus import redis
from services.scanner.engine import Scanner

app = FastAPI(title="Derton Intelligence API")


@app.get("/health")
async def health():
    pong = await redis().ping()
    return {"redis": pong, "status": "ok"}


@app.get("/scanner/{horizon}")
async def scanner(horizon: str, limit: int = 20):
    if horizon not in ("30s", "2m", "15m", "eod"):
        raise HTTPException(400, "bad horizon")
    return await Scanner.top(horizon, limit)


@app.get("/prediction/{horizon}/{symbol}")
async def prediction(horizon: str, symbol: str):
    p = await redis().hgetall(f"pred:{horizon}:{symbol}")
    if not p:
        raise HTTPException(404, "no live prediction")
    regime = await redis().get(f"regime:{symbol}")
    return {"symbol": symbol, "horizon": horizon, "regime": regime, **p}


@app.get("/explain/{horizon}/{symbol}")
async def explain(horizon: str, symbol: str):
    ch = get_client()
    rows = ch.query(
        "SELECT base_value, top_positive_features, top_negative_features "
        "FROM predictions.shap_contributions FINAL "
        f"WHERE symbol='{symbol}' AND horizon='{horizon}' "
        "ORDER BY timestamp DESC LIMIT 1").result_rows
    if not rows:
        raise HTTPException(404, "no explanation")
    base, pos, neg = rows[0]
    return {"base_value": base, "top_positive_features": pos,
            "top_negative_features": neg}


@app.get("/narrate/{symbol}")
async def narrate(symbol: str):
    """Compose factual events into a plain-language 'what's happening' string.

    Pulls live prediction + regime + strategy + SHAP drivers and phrases them.
    No new numbers are invented; the LLM only rewrites the facts (describe, not
    predict). LLM call is omitted here — returns the structured facts to phrase.
    """
    pred = await redis().hgetall(f"pred:15m:{symbol}")
    regime = await redis().get(f"regime:{symbol}")
    strat = await redis().hgetall(f"strat:{symbol}")
    ltp = await redis().hgetall(f"ltp:{symbol}")
    return {"symbol": symbol, "ltp": ltp, "regime": regime,
            "strategy": strat, "prediction": pred}


@app.get("/report/{report_date}")
async def eod_report(report_date: str):
    ch = get_client()
    return ch.query_df(
        f"SELECT * FROM analytics.eod_reports WHERE report_date='{report_date}' "
        "ORDER BY abs(change_pct) DESC").to_dict("records")
