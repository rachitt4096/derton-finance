"""Build point-in-time labelled datasets straight from ClickHouse.

Labels are forward returns over each horizon, computed in SQL with no look-ahead:
the label for (symbol, t) uses the close at t and the close at t + horizon, and
the features used are exactly the features_1m row AT t (already past-only).
"""
from __future__ import annotations

import pandas as pd

from services.common.clickhouse import get_client

HORIZON_BARS = {"30s": 1, "2m": 2, "15m": 15, "eod": None}  # eod handled separately


def build_dataset(horizon: str, start: str, end: str,
                  universe_filter: str = "1") -> pd.DataFrame:
    ch = get_client()
    bars = HORIZON_BARS[horizon]

    if horizon == "eod":
        label_sql = """
            anyLast(d.close) OVER (PARTITION BY f.symbol, toDate(f.timestamp)
                                   ORDER BY f.timestamp
                                   ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING)
        """
        # simpler: join daily close
        sql = f"""
        SELECT f.*,
               (dc.close / c.close - 1) AS fwd_return,
               if(dc.close > c.close, 1, 0) AS label
        FROM features.features_1m f
        INNER JOIN market_data.candles_1m c USING (symbol, timestamp)
        INNER JOIN market_data.candles_daily dc
            ON dc.symbol = f.symbol AND dc.timestamp = toDate(f.timestamp)
        WHERE f.timestamp BETWEEN '{start}' AND '{end}' AND {universe_filter}
        """
    else:
        sql = f"""
        WITH fwd AS (
            SELECT symbol, timestamp,
                   leadInFrame(close, {bars}) OVER (
                       PARTITION BY symbol ORDER BY timestamp
                       ROWS BETWEEN CURRENT ROW AND {bars} FOLLOWING) AS fclose,
                   close
            FROM market_data.candles_1m
            WHERE timestamp BETWEEN '{start}' AND '{end}'
        )
        SELECT f.*, (fwd.fclose / fwd.close - 1) AS fwd_return,
               if(fwd.fclose > fwd.close, 1, 0) AS label
        FROM features.features_1m f
        INNER JOIN fwd USING (symbol, timestamp)
        WHERE fwd.fclose > 0 AND {universe_filter}
        """
    return ch.query_df(sql)
