from __future__ import annotations

from clickhouse_driver import Client as CHClient
from app.config import settings

_ch_client: CHClient | None = None


def get_ch_client() -> CHClient:
    global _ch_client
    if _ch_client is None:
        _ch_client = CHClient(
            host=settings.CLICKHOUSE_HOST,
            port=settings.CLICKHOUSE_PORT,
            user=settings.CLICKHOUSE_USER,
            password=settings.CLICKHOUSE_PASSWORD,
            database=settings.CLICKHOUSE_DATABASE,
            settings={"max_execution_time": 30},
        )
    return _ch_client


async def init_clickhouse() -> None:
    bootstrap_client = CHClient(
        host=settings.CLICKHOUSE_HOST,
        port=settings.CLICKHOUSE_PORT,
        user=settings.CLICKHOUSE_USER,
        password=settings.CLICKHOUSE_PASSWORD,
        settings={"max_execution_time": 30},
    )
    bootstrap_client.execute(f"CREATE DATABASE IF NOT EXISTS {settings.CLICKHOUSE_DATABASE}")
    bootstrap_client.disconnect()

    client = get_ch_client()
    client.execute(
        """
        CREATE TABLE IF NOT EXISTS market_ticks (
            symbol          String,
            recorded_at     DateTime64(3),
            price           Float64,
            prev_close      Float64 DEFAULT 0,
            day_open        Float64 DEFAULT 0,
            day_high        Float64 DEFAULT 0,
            day_low         Float64 DEFAULT 0,
            avg_price       Float64 DEFAULT 0,
            volume          Nullable(Float64),
            cum_volume      Float64 DEFAULT 0,
            last_trade_qty  Int64 DEFAULT 0,
            total_buy_qty   Float64 DEFAULT 0,
            total_sell_qty  Float64 DEFAULT 0,
            bid_price       Float64 DEFAULT 0,
            bid_qty         Int64 DEFAULT 0,
            ask_price       Float64 DEFAULT 0,
            ask_qty         Int64 DEFAULT 0,
            bid_price_2     Float64 DEFAULT 0,
            bid_qty_2       Int64 DEFAULT 0,
            bid_price_3     Float64 DEFAULT 0,
            bid_qty_3       Int64 DEFAULT 0,
            bid_price_4     Float64 DEFAULT 0,
            bid_qty_4       Int64 DEFAULT 0,
            bid_price_5     Float64 DEFAULT 0,
            bid_qty_5       Int64 DEFAULT 0,
            ask_price_2     Float64 DEFAULT 0,
            ask_qty_2       Int64 DEFAULT 0,
            ask_price_3     Float64 DEFAULT 0,
            ask_qty_3       Int64 DEFAULT 0,
            ask_price_4     Float64 DEFAULT 0,
            ask_qty_4       Int64 DEFAULT 0,
            ask_price_5     Float64 DEFAULT 0,
            ask_qty_5       Int64 DEFAULT 0,
            oi              Float64 DEFAULT 0,
            iv              Float64 DEFAULT 0,
            net_change      Float64 DEFAULT 0,
            pct_change      Float64 DEFAULT 0,
            payload         Nullable(String),
            created_at      DateTime DEFAULT now()
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(recorded_at)
        ORDER BY (symbol, recorded_at)
        SETTINGS index_granularity = 8192
        """
    )
    # Migrate existing table: add new columns if they don't exist, remove old TTL
    _migrate_market_ticks(client)
    client.execute(
        """
        CREATE TABLE IF NOT EXISTS market_candles (
            symbol String,
            interval String,
            bucket_start DateTime64(3),
            first_trade_at DateTime64(3),
            last_trade_at DateTime64(3),
            open Float64,
            high Float64,
            low Float64,
            close Float64,
            volume Float64 DEFAULT 0,
            source String DEFAULT 'broker',
            created_at DateTime DEFAULT now(),
            updated_at DateTime DEFAULT now()
        )
        ENGINE = ReplacingMergeTree(updated_at)
        PARTITION BY toYYYYMM(bucket_start)
        ORDER BY (symbol, interval, bucket_start)
        TTL toDateTime(bucket_start) + INTERVAL 365 DAY
        SETTINGS index_granularity = 8192
        """
    )


def _migrate_market_ticks(client: CHClient) -> None:
    new_columns = [
        ("prev_close",     "Float64 DEFAULT 0"),
        ("day_open",       "Float64 DEFAULT 0"),
        ("day_high",       "Float64 DEFAULT 0"),
        ("day_low",        "Float64 DEFAULT 0"),
        ("avg_price",      "Float64 DEFAULT 0"),
        ("cum_volume",     "Float64 DEFAULT 0"),
        ("last_trade_qty", "Int64 DEFAULT 0"),
        ("total_buy_qty",  "Float64 DEFAULT 0"),
        ("total_sell_qty", "Float64 DEFAULT 0"),
        ("bid_price",      "Float64 DEFAULT 0"),
        ("bid_qty",        "Int64 DEFAULT 0"),
        ("ask_price",      "Float64 DEFAULT 0"),
        ("ask_qty",        "Int64 DEFAULT 0"),
        ("bid_price_2",    "Float64 DEFAULT 0"),
        ("bid_qty_2",      "Int64 DEFAULT 0"),
        ("bid_price_3",    "Float64 DEFAULT 0"),
        ("bid_qty_3",      "Int64 DEFAULT 0"),
        ("bid_price_4",    "Float64 DEFAULT 0"),
        ("bid_qty_4",      "Int64 DEFAULT 0"),
        ("bid_price_5",    "Float64 DEFAULT 0"),
        ("bid_qty_5",      "Int64 DEFAULT 0"),
        ("ask_price_2",    "Float64 DEFAULT 0"),
        ("ask_qty_2",      "Int64 DEFAULT 0"),
        ("ask_price_3",    "Float64 DEFAULT 0"),
        ("ask_qty_3",      "Int64 DEFAULT 0"),
        ("ask_price_4",    "Float64 DEFAULT 0"),
        ("ask_qty_4",      "Int64 DEFAULT 0"),
        ("ask_price_5",    "Float64 DEFAULT 0"),
        ("ask_qty_5",      "Int64 DEFAULT 0"),
        ("oi",             "Float64 DEFAULT 0"),
        ("iv",             "Float64 DEFAULT 0"),
        ("net_change",     "Float64 DEFAULT 0"),
        ("pct_change",     "Float64 DEFAULT 0"),
    ]
    existing = {
        row[0]
        for row in client.execute(
            "SELECT name FROM system.columns WHERE table = 'market_ticks' AND database = currentDatabase()"
        )
    }
    for col, col_type in new_columns:
        if col not in existing:
            client.execute(f"ALTER TABLE market_ticks ADD COLUMN IF NOT EXISTS {col} {col_type}")
    try:
        client.execute("ALTER TABLE market_ticks REMOVE TTL")
    except Exception:
        pass


async def close_clickhouse() -> None:
    global _ch_client
    if _ch_client:
        _ch_client.disconnect()
        _ch_client = None
