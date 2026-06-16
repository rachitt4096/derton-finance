-- ============================================================================
-- 004_backtesting.sql  —  walk-forward runs, simulated trades, metrics
-- ============================================================================

CREATE DATABASE IF NOT EXISTS backtesting;

-- One row per backtest run (a full walk-forward sweep for one config).
CREATE TABLE IF NOT EXISTS backtesting.runs
(
    run_id          UUID,
    model_version   LowCardinality(String),
    horizon         LowCardinality(String),
    strategy        LowCardinality(String),
    universe        String,                            -- e.g. 'NIFTY500'
    period_start    DateTime,
    period_end      DateTime,
    walk_window_days UInt16,
    retrain_step_days UInt16,
    slippage_bps    Float32,
    brokerage_model LowCardinality(String),
    sizing_model    LowCardinality(String),
    params          String,                            -- full JSON config
    created_at      DateTime DEFAULT now()
)
ENGINE = MergeTree
ORDER BY (created_at, run_id);

-- Every simulated trade. Partitioned by run for cheap drop/recompute.
CREATE TABLE IF NOT EXISTS backtesting.trades
(
    run_id        UUID,
    symbol        LowCardinality(String),
    horizon       LowCardinality(String),
    entry_time    DateTime64(3, 'Asia/Kolkata'),
    exit_time     DateTime64(3, 'Asia/Kolkata'),
    side          Enum8('long' = 1, 'short' = -1),
    entry_price   Float64,
    exit_price    Float64,
    qty           UInt32,
    gross_pnl     Float64,
    fees          Float64,
    slippage      Float64,
    net_pnl       Float64,
    return_pct    Float32,
    probability_up Float32,
    confidence    Float32,
    holding_secs  UInt32
)
ENGINE = MergeTree
PARTITION BY run_id
ORDER BY (run_id, symbol, entry_time);

-- Aggregate metrics per run (and optionally per walk-forward fold).
CREATE TABLE IF NOT EXISTS backtesting.metrics
(
    run_id           UUID,
    fold             Int16 DEFAULT -1,                 -- -1 = overall
    n_trades         UInt32,
    accuracy         Float32,
    precision        Float32,
    recall           Float32,
    sharpe           Float32,
    sortino          Float32,
    max_drawdown     Float32,
    profit_factor    Float32,
    calibration_error Float32,                         -- ECE
    total_return     Float32,
    win_rate         Float32,
    avg_win          Float32,
    avg_loss         Float32,
    created_at       DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (run_id, fold);
