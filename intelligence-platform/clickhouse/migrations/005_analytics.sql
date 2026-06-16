-- ============================================================================
-- 005_analytics.sql  —  regimes, strategies, monitoring/drift, EOD reports
-- ============================================================================

CREATE DATABASE IF NOT EXISTS analytics;

-- Regime classification per symbol (and per index when symbol is an index).
CREATE TABLE IF NOT EXISTS analytics.regime_classifications
(
    timestamp   DateTime('Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),
    symbol      LowCardinality(String),
    regime      Enum8('TrendingBull'=1, 'TrendingBear'=2, 'Sideways'=3,
                      'HighVolatility'=4, 'LowVolatility'=5),
    confidence  Float32 CODEC(Gorilla, ZSTD(1)),
    timeframe   LowCardinality(String) DEFAULT '15m',
    created_at  DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, timeframe, timestamp);

-- Strategy scores [0,1] per symbol per strategy.
CREATE TABLE IF NOT EXISTS analytics.strategy_scores
(
    timestamp DateTime('Asia/Kolkata') CODEC(DoubleDelta, ZSTD(1)),
    symbol    LowCardinality(String),
    strategy  Enum8('Momentum'=1, 'Breakout'=2, 'Pullback'=3,
                   'MeanReversion'=4, 'GapContinuation'=5),
    score     Float32 CODEC(Gorilla, ZSTD(1)),
    timeframe LowCardinality(String) DEFAULT '5m',
    created_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (symbol, strategy, timeframe, timestamp);

-- Model monitoring: drift + degradation, written nightly by the monitor job.
CREATE TABLE IF NOT EXISTS analytics.model_monitoring
(
    eval_date        Date,
    model_version    LowCardinality(String),
    horizon          LowCardinality(String),
    metric_type      Enum8('data_drift'=1, 'feature_drift'=2,
                          'accuracy'=3, 'calibration'=4),
    feature          LowCardinality(String) DEFAULT '',  -- '' for whole-model metrics
    value            Float32,
    baseline         Float32,
    threshold        Float32,
    breached         UInt8,
    detail           String,                              -- JSON
    created_at       DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(eval_date)
ORDER BY (model_version, horizon, metric_type, feature, eval_date);

-- EOD report snapshots (the descriptive "what happened today" narration + facts).
CREATE TABLE IF NOT EXISTS analytics.eod_reports
(
    report_date Date,
    symbol      LowCardinality(String),
    close       Float64,
    change_pct  Float32,
    volume      UInt64,
    regime      LowCardinality(String),
    top_strategy LowCardinality(String),
    eod_prob_up Float32,
    narrative   String,                                  -- LLM-phrased facts
    facts       String,                                  -- JSON of signal events
    created_at  DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(report_date)
ORDER BY (report_date, symbol);
