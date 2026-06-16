"""Celery app + beat schedule for the batch clock.

Queues:
  realtime  — outcome resolution (frequent)
  batch     — EOD reports, backtests
  training  — nightly retrain, drift, promotion (heavy, separate workers)
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from celery import Celery
from celery.schedules import crontab

from services.common.config import settings

app = Celery("derton", broker=settings.redis_url, backend=settings.redis_url)
app.conf.task_routes = {
    "workers.*.train_*": {"queue": "training"},
    "workers.*.backtest_*": {"queue": "batch"},
    "workers.*.eod_*": {"queue": "batch"},
    "workers.*.resolve_*": {"queue": "realtime"},
}

app.conf.beat_schedule = {
    "resolve-outcomes": {                # join predictions->realized returns
        "task": "workers.celery_app.resolve_outcomes",
        "schedule": 60.0,
    },
    "eod-reports": {                     # after market close (IST ~15:45)
        "task": "workers.celery_app.eod_reports",
        "schedule": crontab(hour=10, minute=20),  # UTC == 15:50 IST
    },
    "nightly-retrain": {
        "task": "workers.celery_app.nightly_retrain",
        "schedule": crontab(hour=18, minute=0),
    },
    "drift-monitor": {
        "task": "workers.celery_app.drift_monitor",
        "schedule": crontab(hour=19, minute=0),
    },
    "weekly-backtest": {
        "task": "workers.celery_app.weekly_backtest",
        "schedule": crontab(day_of_week="sun", hour=20, minute=0),
    },
}


@app.task
def resolve_outcomes():
    """Fill predictions.outcomes for horizons that have now elapsed."""
    from services.common.clickhouse import get_client
    ch = get_client()
    for h, secs in {"30s": 30, "2m": 120, "15m": 900}.items():
        ch.command(f"""
        INSERT INTO predictions.outcomes
        SELECT p.timestamp, p.symbol, '{h}', p.model_version,
               if(p.probability_up>0.5,1,0),
               p.probability_up,
               (c2.close/c1.close - 1) AS realized_return,
               if(c2.close>c1.close,1,0) AS realized_up,
               if((p.probability_up>0.5)=(c2.close>c1.close),1,0),
               now64(3)
        FROM predictions.prediction_{h} p
        INNER JOIN market_data.candles_1m c1
            ON c1.symbol=p.symbol AND c1.timestamp=toStartOfMinute(p.timestamp)
        INNER JOIN market_data.candles_1m c2
            ON c2.symbol=p.symbol
           AND c2.timestamp=toStartOfMinute(p.timestamp + INTERVAL {secs} SECOND)
        WHERE p.timestamp >= now() - INTERVAL 1 HOUR
          AND p.timestamp <= now() - INTERVAL {secs} SECOND
        """)


@app.task
def eod_reports():
    """Generate descriptive EOD reports per symbol (facts -> narrative)."""
    # query daily candle + regime + top strategy + eod prediction, store row
    ...


@app.task
def nightly_retrain():
    from services.training.train_xgb import train_all
    from services.training.registry import promote
    end = datetime.utcnow().date().isoformat()
    start = (datetime.utcnow().date() - timedelta(days=365 * 4)).isoformat()
    version = "v" + datetime.utcnow().strftime("%Y%m%d")
    train_all(start, end, version)
    for h in settings.horizons:
        promote(h, version)             # promote after validation gates pass


@app.task
def drift_monitor():
    from services.monitoring.drift import run_monitor
    asyncio.run(run_monitor())


@app.task
def weekly_backtest():
    from services.backtesting.engine import BTConfig, run_backtest
    for h in settings.horizons:
        run_backtest(BTConfig(horizon=h))
