-- ============================================================================
-- 002_features.sql  —  engineered feature store
-- ReplacingMergeTree(feature_version) so recomputing a (symbol, ts) overwrites.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS features;

CREATE TABLE IF NOT EXISTS features.features_1m
(
    timestamp        DateTime('Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),
    symbol           LowCardinality(String),

    -- trend / momentum
    rsi_14           Float32 CODEC(Gorilla, ZSTD(1)),
    ema_9            Float32 CODEC(Gorilla, ZSTD(1)),
    ema_20           Float32 CODEC(Gorilla, ZSTD(1)),
    ema_50           Float32 CODEC(Gorilla, ZSTD(1)),
    ema_200          Float32 CODEC(Gorilla, ZSTD(1)),
    macd             Float32 CODEC(Gorilla, ZSTD(1)),
    macd_signal      Float32 CODEC(Gorilla, ZSTD(1)),
    macd_hist        Float32 CODEC(Gorilla, ZSTD(1)),

    -- volatility
    atr              Float32 CODEC(Gorilla, ZSTD(1)),
    bollinger_width  Float32 CODEC(Gorilla, ZSTD(1)),
    volatility_rank  Float32 CODEC(Gorilla, ZSTD(1)),   -- cross-sectional [0,1]

    -- volume / flow
    volume_ratio     Float32 CODEC(Gorilla, ZSTD(1)),   -- vol / 20-bar avg
    vwap_distance    Float32 CODEC(Gorilla, ZSTD(1)),   -- (close-vwap)/vwap
    liquidity_rank   Float32 CODEC(Gorilla, ZSTD(1)),   -- cross-sectional [0,1]

    -- returns
    return_1         Float32 CODEC(Gorilla, ZSTD(1)),
    return_3         Float32 CODEC(Gorilla, ZSTD(1)),
    return_5         Float32 CODEC(Gorilla, ZSTD(1)),
    return_10        Float32 CODEC(Gorilla, ZSTD(1)),

    -- cross-sectional / context
    sector_strength    Float32 CODEC(Gorilla, ZSTD(1)),
    market_strength    Float32 CODEC(Gorilla, ZSTD(1)),
    relative_strength  Float32 CODEC(Gorilla, ZSTD(1)),

    feature_version  LowCardinality(String) DEFAULT 'fv1',
    computed_at      DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp)
TTL toDateTime(timestamp) + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;

-- 5m / 15m feature stores share the schema (same columns, coarser bars).
CREATE TABLE IF NOT EXISTS features.features_5m AS features.features_1m
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

CREATE TABLE IF NOT EXISTS features.features_15m AS features.features_1m
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

-- Daily features kept forever for long-horizon / EOD models.
CREATE TABLE IF NOT EXISTS features.features_daily
(
    timestamp Date,
    symbol LowCardinality(String),
    rsi_14 Float32, ema_9 Float32, ema_20 Float32, ema_50 Float32, ema_200 Float32,
    macd Float32, macd_signal Float32, macd_hist Float32,
    atr Float32, bollinger_width Float32, volatility_rank Float32,
    volume_ratio Float32, vwap_distance Float32, liquidity_rank Float32,
    return_1 Float32, return_3 Float32, return_5 Float32, return_10 Float32,
    sector_strength Float32, market_strength Float32, relative_strength Float32,
    feature_version LowCardinality(String) DEFAULT 'fv1',
    computed_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(computed_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp);

-- Feature registry: documents each feature so training/serving stay in sync and
-- drift monitoring knows the expected ranges. One row per (feature_version, name).
CREATE TABLE IF NOT EXISTS features.feature_registry
(
    feature_version LowCardinality(String),
    name            String,
    dtype           String,
    description     String,
    train_mean      Float64,
    train_std       Float64,
    train_p01       Float64,
    train_p99       Float64,
    created_at      DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (feature_version, name);
