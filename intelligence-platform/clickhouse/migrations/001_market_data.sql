-- ============================================================================
-- 001_market_data.sql  —  raw ticks + OHLC candles (source of truth)
-- Idempotent: every statement is CREATE ... IF NOT EXISTS.
-- Scale-out: change `MergeTree` -> `ReplicatedMergeTree('/ch/{shard}/...', '{replica}')`
--            and front with a `Distributed` table sharded by cityHash64(symbol).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS market_data;

-- ----------------------------------------------------------------------------
-- ticks : raw tick-level feed from Upstox WS V3
--   `volume` is the cumulative day volume reported by the feed; per-candle
--   volume is derived as a delta in the rollups below. `ltq` (last traded qty)
--   is kept so we never have to guess.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_data.ticks
(
    timestamp   DateTime64(3, 'Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),
    symbol      LowCardinality(String),
    ltp         Float64 CODEC(Gorilla, ZSTD(1)),
    ltq         UInt32  CODEC(T64, ZSTD(1)),
    volume      UInt64  CODEC(DoubleDelta, ZSTD(1)),   -- cumulative day volume
    bid_price   Float64 CODEC(Gorilla, ZSTD(1)),
    ask_price   Float64 CODEC(Gorilla, ZSTD(1)),
    bid_qty     UInt32  CODEC(T64, ZSTD(1)),
    ask_qty     UInt32  CODEC(T64, ZSTD(1)),
    ingested_at DateTime64(3) DEFAULT now64(3) CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;

-- ----------------------------------------------------------------------------
-- candles_1m : base OHLC table. Written directly by the candle builder service
--   AND/OR populated from ticks by the materialized view below. Both paths use
--   ReplacingMergeTree so a re-emitted (corrected) candle overwrites the old.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_data.candles_1m
(
    timestamp  DateTime('Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),  -- bucket start
    symbol     LowCardinality(String),
    open       Float64 CODEC(Gorilla, ZSTD(1)),
    high       Float64 CODEC(Gorilla, ZSTD(1)),
    low        Float64 CODEC(Gorilla, ZSTD(1)),
    close      Float64 CODEC(Gorilla, ZSTD(1)),
    volume     UInt64  CODEC(DoubleDelta, ZSTD(1)),   -- per-candle traded volume
    trades     UInt32  CODEC(T64, ZSTD(1)),
    vwap       Float64 CODEC(Gorilla, ZSTD(1)),
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp)
SETTINGS index_granularity = 8192;

-- Aggregated intermediate state from ticks -> 1m. We keep candle volume as a
-- delta of cumulative feed volume via max()-min() inside the bucket.
CREATE TABLE IF NOT EXISTS market_data.candles_1m_state
(
    timestamp   DateTime('Asia/Kolkata'),
    symbol      LowCardinality(String),
    open_st     AggregateFunction(argMin, Float64, DateTime64(3)),
    high_st     AggregateFunction(max, Float64),
    low_st      AggregateFunction(min, Float64),
    close_st    AggregateFunction(argMax, Float64, DateTime64(3)),
    vol_max     AggregateFunction(max, UInt64),
    vol_min     AggregateFunction(min, UInt64),
    pv_st       AggregateFunction(sum, Float64),       -- sum(ltp*ltq) for vwap
    qty_st      AggregateFunction(sum, UInt64),        -- sum(ltq)
    trades_st   AggregateFunction(count, UInt8)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

CREATE MATERIALIZED VIEW IF NOT EXISTS market_data.mv_ticks_to_1m
TO market_data.candles_1m_state AS
SELECT
    toStartOfMinute(timestamp)                  AS timestamp,
    symbol,
    argMinState(ltp, timestamp)                 AS open_st,
    maxState(ltp)                               AS high_st,
    minState(ltp)                               AS low_st,
    argMaxState(ltp, timestamp)                 AS close_st,
    maxState(volume)                            AS vol_max,
    minState(volume)                            AS vol_min,
    sumState(ltp * ltq)                         AS pv_st,
    sumState(toUInt64(ltq))                     AS qty_st,
    countState()                                AS trades_st
FROM market_data.ticks
GROUP BY symbol, timestamp;

-- Convenience view to read finished 1m candles from the aggregate state.
CREATE VIEW IF NOT EXISTS market_data.candles_1m_agg AS
SELECT
    timestamp,
    symbol,
    argMinMerge(open_st)                         AS open,
    maxMerge(high_st)                            AS high,
    minMerge(low_st)                             AS low,
    argMaxMerge(close_st)                        AS close,
    (maxMerge(vol_max) - minMerge(vol_min))     AS volume,
    countMerge(trades_st)                        AS trades,
    if(sumMerge(qty_st) = 0, argMaxMerge(close_st),
       sumMerge(pv_st) / sumMerge(qty_st))       AS vwap
FROM market_data.candles_1m_state
GROUP BY symbol, timestamp;

-- ----------------------------------------------------------------------------
-- Higher timeframes roll up FROM candles_1m via MV. Same shape everywhere.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_data.candles_5m
(
    timestamp DateTime('Asia/Kolkata'),
    symbol LowCardinality(String),
    open Float64, high Float64, low Float64, close Float64,
    volume UInt64, vwap Float64,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

CREATE TABLE IF NOT EXISTS market_data.candles_15m AS market_data.candles_5m
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

CREATE TABLE IF NOT EXISTS market_data.candles_daily
(
    timestamp Date,
    symbol LowCardinality(String),
    open Float64, high Float64, low Float64, close Float64,
    volume UInt64, vwap Float64,
    updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

-- Roll 1m -> 5m. (argMin/argMax over close keeps true open/close of the bucket.)
CREATE MATERIALIZED VIEW IF NOT EXISTS market_data.mv_1m_to_5m
TO market_data.candles_5m AS
SELECT
    toStartOfInterval(timestamp, INTERVAL 5 MINUTE) AS timestamp,
    symbol,
    argMin(open, timestamp)  AS open,
    max(high)                AS high,
    min(low)                 AS low,
    argMax(close, timestamp) AS close,
    sum(volume)              AS volume,
    sum(vwap * volume) / nullIf(sum(volume), 0) AS vwap,
    max(updated_at)          AS updated_at
FROM market_data.candles_1m
GROUP BY symbol, timestamp;

CREATE MATERIALIZED VIEW IF NOT EXISTS market_data.mv_1m_to_15m
TO market_data.candles_15m AS
SELECT
    toStartOfInterval(timestamp, INTERVAL 15 MINUTE) AS timestamp,
    symbol,
    argMin(open, timestamp)  AS open,
    max(high)                AS high,
    min(low)                 AS low,
    argMax(close, timestamp) AS close,
    sum(volume)              AS volume,
    sum(vwap * volume) / nullIf(sum(volume), 0) AS vwap,
    max(updated_at)          AS updated_at
FROM market_data.candles_1m
GROUP BY symbol, timestamp;

CREATE MATERIALIZED VIEW IF NOT EXISTS market_data.mv_1m_to_daily
TO market_data.candles_daily AS
SELECT
    toDate(timestamp)        AS timestamp,
    symbol,
    argMin(open, timestamp)  AS open,
    max(high)                AS high,
    min(low)                 AS low,
    argMax(close, timestamp) AS close,
    sum(volume)              AS volume,
    sum(vwap * volume) / nullIf(sum(volume), 0) AS vwap,
    max(updated_at)          AS updated_at
FROM market_data.candles_1m
GROUP BY symbol, timestamp;
