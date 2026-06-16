-- ============================================================================
-- 003_predictions.sql  —  model outputs, SHAP, realized outcomes, model registry
-- ============================================================================

CREATE DATABASE IF NOT EXISTS predictions;

-- One table per horizon; identical shape so the API/scanner are horizon-generic.
CREATE TABLE IF NOT EXISTS predictions.prediction_30s
(
    timestamp        DateTime64(3, 'Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),
    symbol           LowCardinality(String),
    probability_up   Float32 CODEC(Gorilla, ZSTD(1)),
    probability_down Float32 CODEC(Gorilla, ZSTD(1)),
    confidence       Float32 CODEC(Gorilla, ZSTD(1)),   -- calibrated [0,1]
    expected_move    Float32 CODEC(Gorilla, ZSTD(1)),   -- E[|return|] over horizon
    model_version    LowCardinality(String),
    feature_version  LowCardinality(String) DEFAULT 'fv1',
    created_at       DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp, model_version)
TTL toDateTime(timestamp) + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS predictions.prediction_2m  AS predictions.prediction_30s
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp) ORDER BY (symbol, timestamp, model_version);

CREATE TABLE IF NOT EXISTS predictions.prediction_15m AS predictions.prediction_30s
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp) ORDER BY (symbol, timestamp, model_version);

CREATE TABLE IF NOT EXISTS predictions.prediction_eod AS predictions.prediction_30s
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp) ORDER BY (symbol, timestamp, model_version);

-- SHAP contributions per prediction. Map column keeps it schema-stable as the
-- feature set evolves; top_* arrays are denormalized for fast "why" reads.
CREATE TABLE IF NOT EXISTS predictions.shap_contributions
(
    timestamp             DateTime64(3, 'Asia/Kolkata'),
    symbol                LowCardinality(String),
    horizon               LowCardinality(String),       -- '30s'|'2m'|'15m'|'eod'
    model_version         LowCardinality(String),
    base_value            Float32,
    feature_contributions Map(LowCardinality(String), Float32),
    top_positive_features Array(Tuple(LowCardinality(String), Float32)),
    top_negative_features Array(Tuple(LowCardinality(String), Float32)),
    created_at            DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp, horizon, model_version)
TTL toDateTime(timestamp) + INTERVAL 180 DAY DELETE;

-- Realized outcomes, filled by a Celery job once the horizon elapses. Joining
-- predictions to outcomes drives monitoring (accuracy/calibration) and reports.
CREATE TABLE IF NOT EXISTS predictions.outcomes
(
    timestamp       DateTime64(3, 'Asia/Kolkata'),
    symbol          LowCardinality(String),
    horizon         LowCardinality(String),
    model_version   LowCardinality(String),
    predicted_up    UInt8,
    probability_up  Float32,
    realized_return Float32,
    realized_up     UInt8,
    correct         UInt8,
    resolved_at     DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(resolved_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timestamp, horizon, model_version);

-- Model registry: metadata for every trained model. Binary artifacts live in
-- MinIO/S3 at artifact_uri; this is the queryable index + lineage.
CREATE TABLE IF NOT EXISTS predictions.model_registry
(
    model_version    LowCardinality(String),
    horizon          LowCardinality(String),
    algo             LowCardinality(String),           -- 'xgboost'|'transformer'
    feature_version  LowCardinality(String),
    train_start      DateTime,
    train_end        DateTime,
    n_samples        UInt64,
    calibration      LowCardinality(String),           -- 'isotonic'|'platt'|'none'
    val_auc          Float32,
    val_accuracy     Float32,
    val_ece          Float32,                          -- expected calibration error
    artifact_uri     String,
    params           String,                           -- JSON
    is_active        UInt8 DEFAULT 0,
    created_at       DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (horizon, model_version);
