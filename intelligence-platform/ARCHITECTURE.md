# Derton Intelligence Platform — Architecture

A production-grade AI market-intelligence data platform for Indian equities (NSE/BSE),
fed by Upstox WebSocket V3. Built to scale to **billions of rows**, run low-latency
inference, and stay descriptive (factual signals phrased by an LLM) — never predictive/advisory
in the SEBI sense for the narration layer, while the quant models produce calibrated
*probabilistic* directional predictions consumed internally and by the scanner.

> Storage of record: **ClickHouse**. Hot state / pub-sub: **Redis**. Compute: **Python +
> FastAPI + Celery**. Everything is containerized and K8s-ready.

---

## 1. Design principles

1. **One write path, many read paths.** Ticks land once; everything downstream (candles,
   features, predictions) is derived deterministically and is reproducible from raw data.
2. **Append-only, partition-by-month, order-by-(symbol, timestamp).** Every analytical table
   follows this so range scans for one symbol over a time window touch the fewest granules.
3. **Push computation into ClickHouse** where it's a set operation (candle rollups, rolling
   features via window functions, backtest aggregation). Pull into Python only for ML.
4. **Idempotent, versioned everything** — migrations, models (`model_version`), feature sets
   (`feature_version`). A prediction row always names the model that produced it.
5. **Latency budget is explicit.** The 30s/2m horizons are served from Redis-cached features
   and an in-process model; ClickHouse is never in the hot inference path.
6. **Fail safe, not silent.** Ingestion gaps, drift, and calibration decay raise alerts and
   are recorded — the system knows when it should not be trusted.

---

## 2. Data flow (event-driven)

```
                                ┌─────────────────────────────────────────────┐
                                │                  REDIS                       │
                                │  ltp:{sym}  book:{sym}  feat:{sym}  pred:*   │
                                │  streams: ticks.raw  candles.1m  preds.new   │
                                └───────▲───────────────────────────┬─────────┘
                                        │ (hot read/write)           │ (pub/sub + streams)
                                        │                            │
 Upstox WS V3 ──► Ingestion ──► Tick Normalizer ──► Candle Builder ──► Feature Engine
   (protobuf)     (asyncio)      (validate/dedupe)   (1m base + MV)     (1m/5m/15m)
                      │                │                   │                  │
                      └──── ClickHouse market_data.ticks ◄─┘                  │
                                       │                                      │
                       candles_1m ◄────┘   (Materialized Views roll up)       │
                       candles_5m / candles_15m / candles_daily               │
                                       │                                      ▼
                                       │                         ClickHouse features.features_1m
                                       │                                      │
                                       ▼                                      ▼
                              Regime + Strategy Engine            Inference Service (XGBoost)
                                       │                          + SHAP + calibration
                                       │                                      │
                                       ▼                                      ▼
                            analytics.regime_classifications     predictions.prediction_{30s,2m,15m,eod}
                            analytics.strategy_scores            predictions.shap_contributions
                                       │                                      │
                                       └──────────────┬───────────────────────┘
                                                      ▼
                                              Scanner Engine
                                   Score = Confidence × ExpectedMove × Liquidity
                                                      │
                                          Redis: scanner:{horizon} (sorted set)
                                                      ▼
                                              FastAPI API Layer ──► Frontend
```

Two clocks run in parallel:

- **Real-time clock** (sub-second → 15m): WS → Redis → in-process inference → Redis scanner.
  ClickHouse is written asynchronously (batched) and is *not* on this path.
- **Batch clock** (EOD / nightly): Celery beat triggers EOD predictions, report generation,
  walk-forward retraining, backtests, and drift evaluation, all reading from ClickHouse.

---

## 3. Folder structure

```
intelligence-platform/
├── ARCHITECTURE.md                  # this file
├── README.md                        # quickstart
├── docker-compose.yml               # local full stack
├── .env.example
├── pyproject.toml
│
├── clickhouse/
│   └── migrations/                  # numbered, idempotent DDL (run in order)
│       ├── 001_market_data.sql      # ticks, candles_1m/5m/15m/daily + MVs
│       ├── 002_features.sql         # features_1m (+5m/15m), feature registry
│       ├── 003_predictions.sql      # prediction_{30s,2m,15m,eod}, shap, outcomes
│       ├── 004_backtesting.sql      # runs, trades, metrics
│       ├── 005_analytics.sql        # regimes, strategies, drift, monitoring
│       └── run_migrations.py        # tracks applied migrations in schema_migrations
│
├── redis/
│   └── REDIS_ARCHITECTURE.md        # keyspace, streams, consumer groups, TTLs
│
├── services/
│   ├── common/
│   │   ├── config.py                # pydantic-settings, single source of env
│   │   ├── clickhouse.py            # pooled client + batched async inserts
│   │   ├── redis_bus.py             # streams producer/consumer helpers
│   │   └── instruments.py           # symbol ↔ instrument_key, sector map
│   ├── ingestion/
│   │   └── ws_client.py             # Upstox WS V3 → normalize → Redis stream + CH batch
│   ├── candles/
│   │   └── builder.py               # tick → 1m candle (event-time, late-tolerant)
│   ├── features/
│   │   └── engine.py                # technical + cross-sectional feature computation
│   ├── inference/
│   │   ├── predictor.py             # load model, predict, calibrate, write predictions
│   │   └── explain.py               # SHAP top contributions
│   ├── scanner/
│   │   └── engine.py                # rank → Redis sorted sets per horizon
│   ├── regime/
│   │   └── classifier.py            # regime + strategy detection
│   ├── training/
│   │   ├── dataset.py               # point-in-time labelled dataset from CH
│   │   ├── train_xgb.py             # multi-horizon XGBoost + calibration
│   │   └── registry.py              # model versioning (MinIO/S3) + metadata in CH
│   ├── backtesting/
│   │   └── engine.py                # walk-forward, slippage, sizing, metrics
│   └── monitoring/
│       └── drift.py                 # data/feature/accuracy/calibration drift → alerts
│
├── api/
│   └── main.py                      # FastAPI: scanner, predictions, narration, health
│
├── workers/
│   └── celery_app.py                # Celery app + beat schedule (EOD/retrain/backtest)
│
├── deploy/
│   ├── docker/                      # per-service Dockerfiles
│   └── k8s/                         # Deployments, StatefulSets, CronJobs, HPA
│
└── docs/
    └── diagrams/                    # mermaid event-flow + sequence diagrams
```

---

## 4. ClickHouse layout

Five databases, each a bounded context:

| DB             | Purpose                                   | Write rate        | Retention |
|----------------|-------------------------------------------|-------------------|-----------|
| `market_data`  | raw ticks + OHLC candles (source of truth)| very high (ticks) | ticks 90d, candles ∞ |
| `features`     | engineered features per timeframe         | high              | 1m: 1y, daily: ∞ |
| `predictions`  | model outputs + SHAP + realized outcomes  | high              | 1y |
| `backtesting`  | runs, trades, metrics                     | bursty (batch)    | ∞ |
| `analytics`    | regimes, strategies, drift, EOD reports   | medium            | ∞ |

**Engine choices**
- Raw immutable streams (`ticks`, predictions, features): `MergeTree`.
- Candle rollups: `AggregatingMergeTree` fed by **Materialized Views** off the base table —
  higher timeframes are *never* computed twice in app code.
- Dedup-prone tables (re-runs of features/predictions for the same key): `ReplacingMergeTree`
  with a `version`/`computed_at` column so re-computation overwrites cleanly.
- Production scale-out: swap each to `Replicated*MergeTree` + `Distributed` over a sharded
  cluster (shard by `cityHash64(symbol)`, replicate ×2). The DDL is written so only the engine
  line changes.

**Why these `PARTITION` / `ORDER BY` choices**
- `PARTITION BY toYYYYMM(timestamp)` → cheap month-level TTL drops and partition pruning.
- `ORDER BY (symbol, timestamp)` → the dominant query is "one symbol, time range"; this makes
  it a contiguous granule scan. Cross-sectional ("all symbols at time T") queries are served
  from the daily/feature tables which are small enough, or from Redis for live.
- `LowCardinality(String)` for `symbol`, `regime`, `strategy`, `model_version` → dictionary
  encoding, big compression + speed win at 1000+ symbols.

See [clickhouse/migrations/](clickhouse/migrations/) for the full DDL.

---

## 5. Redis architecture

Redis is the real-time tier — never the system of record. Full keyspace, streams, consumer
groups and TTLs in [redis/REDIS_ARCHITECTURE.md](redis/REDIS_ARCHITECTURE.md). Summary:

| Pattern         | Key / Stream                    | Type        | TTL    |
|-----------------|----------------------------------|-------------|--------|
| Latest price    | `ltp:{symbol}`                  | hash        | 1d     |
| Order book top  | `book:{symbol}`                 | hash        | 1d     |
| Live features   | `feat:{symbol}`                 | hash        | 5m     |
| Live prediction | `pred:{horizon}:{symbol}`       | hash        | horizon|
| Scanner ranking | `scanner:{horizon}`             | sorted set  | 1m     |
| Active signals  | `signals:active`                | sorted set  | session|
| Raw tick bus    | `stream:ticks.raw`              | stream      | maxlen |
| Candle bus      | `stream:candles.1m`             | stream      | maxlen |
| New predictions | `stream:preds.new`              | stream      | maxlen |

Each consumer (candle builder, feature engine, scanner) is a Redis **consumer group** so work
is partitioned and survives restarts (XACK + XAUTOCLAIM for crash recovery).

---

## 6. Model architecture

**V1 = XGBoost**, one binary classifier per horizon: `30s`, `2m`, `15m`, `eod`. Each predicts
P(up). Probabilities are **calibrated** post-hoc (Isotonic for ≥ ~5k validation samples per
horizon, Platt/sigmoid otherwise) and the calibrator is versioned with the model.

```
prediction = {
  probability_up, probability_down (=1-up),
  confidence   = |2*p_up - 1|   (distance from coin-flip, then scaled by calibration sharpness),
  expected_move = E[|return| | direction] estimated from a companion quantile/regression head,
  model_version
}
```

**Explainability (SHAP)** — `TreeExplainer` runs on every prediction (it's microseconds for a
single row on a gradient-boosted tree). We persist `top_positive_features`,
`top_negative_features`, and the full `feature_contributions` map per prediction into
`predictions.shap_contributions`. This powers the "why" in the narrator and EOD report.

**Multi-horizon** models share the feature store but have independent label windows and
independent calibration. They are trained together nightly from the same point-in-time dataset.

**V2 path (Transformer experiments)** — a separate `services/training/train_transformer.py`
trains a sequence model on the same labelled windows; it writes predictions under a distinct
`model_version` (e.g. `tx-1m-2026.06`) into the *same* prediction tables, so A/B and shadow
evaluation are just `GROUP BY model_version` queries. No schema change required.

---

## 7. Regime & strategy engines

- **Regime classifier** (`services/regime/classifier.py`): per symbol + per index, classifies
  `Trending Bull | Trending Bear | Sideways | High Volatility | Low Volatility` from ADX,
  EMA slope/stack, ATR percentile, and realized-vol rank. Output → `analytics.regime_classifications`.
  Used as a *gating feature* — strategies and the scanner weight differently per regime.
- **Strategy detector**: scores each of `Momentum | Breakout | Pullback | Mean Reversion |
  Gap Continuation` in [0,1] from deterministic rules over features. Output →
  `analytics.strategy_scores`. These are inputs to the model *and* surfaced directly.

---

## 8. Scanner engine

Continuously (every few seconds during market hours) ranks symbols per horizon:

```
Score = confidence × expected_move × liquidity_rank
```

`liquidity_rank` is a precomputed [0,1] from 20-day median turnover (so a thin stock with a
huge predicted move can't dominate the actionable list). The scanner reads live `pred:*` and
`feat:*` from Redis, computes scores, and writes `scanner:{horizon}` sorted sets. The API
returns top-N per horizon with O(log N) reads. Nothing hits ClickHouse on the hot path.

---

## 9. Backtesting framework

`services/backtesting/engine.py` is a **walk-forward** harness:

- **Walk-forward / rolling retrain**: train on `[t-W, t)`, predict/trade `[t, t+S)`, roll by `S`.
- **Execution realism**: configurable slippage (bps + spread-aware), brokerage (per-order +
  STT/exchange/GST), and **position sizing** (fixed-fractional, vol-targeted, Kelly-capped).
- **Metrics**: Accuracy, Precision, Recall, Sharpe, Sortino, Max Drawdown, Profit Factor, and
  **Calibration Error (ECE)** — stored to `backtesting.runs` / `backtesting.trades` /
  `backtesting.metrics`, all keyed by `run_id` + `model_version` for comparison over time.

No look-ahead: labels and features are built point-in-time from the candle store, and the
backtester only ever reads data with `timestamp <= decision_time`.

---

## 10. Continuous learning & monitoring

Every prediction is stored; outcomes are joined back when the horizon elapses
(`predictions.outcomes` filled by a Celery job that reads realized candle returns). The monitor
(`services/monitoring/drift.py`) computes nightly:

- **Data drift** — PSI/KL on raw feature distributions vs. the training window.
- **Feature drift** — per-feature population stability index, flag > 0.2.
- **Accuracy degradation** — rolling accuracy/AUC vs. backtest baseline, flag relative drop.
- **Calibration degradation** — rolling ECE / reliability slope.

Results land in `analytics.model_monitoring`; threshold breaches push to
`stream:alerts` and (optionally) trigger an auto-retrain Celery task.

---

## 11. Deployment & K8s

**Local**: `docker-compose up` (ClickHouse, Redis, MinIO, API, and the worker services).

**Production (K8s)** — see [deploy/k8s/](deploy/k8s/):

| Component        | K8s kind            | Notes |
|------------------|---------------------|-------|
| ClickHouse       | `StatefulSet` (operator: Altinity) | sharded+replicated, PVCs, anti-affinity |
| Redis            | `StatefulSet` (Sentinel/Cluster)   | AOF persistence |
| MinIO            | `StatefulSet`                      | model + dataset artifacts |
| Ingestion        | `Deployment` (single active)       | leader-elected; WS is stateful |
| Candle/Feature   | `Deployment` + HPA                 | scale by Redis stream lag |
| Inference        | `Deployment` + HPA                 | scale by request latency/QPS |
| Scanner          | `Deployment`                       | one active |
| API              | `Deployment` + HPA + Ingress       | stateless |
| Celery workers   | `Deployment` + HPA                 | queue-length scaled (KEDA) |
| Celery beat      | `Deployment` (single)              | schedules EOD/retrain/backtest |
| EOD/retrain      | `CronJob`                          | nightly |

Autoscaling: **KEDA** on Redis stream lag (ingestion→features) and Celery queue depth;
HPA on CPU/latency for API + inference. Ingestion and scanner are singletons via leader
election (they own external connections / global ranking).

Observability: Prometheus metrics from every service, ClickHouse `system.*` dashboards,
Grafana; structured JSON logs to Loki; `stream:alerts` → Alertmanager.

---

## 12. Latency budget (real-time path)

| Stage                         | Target     |
|-------------------------------|------------|
| WS frame → normalized tick    | < 2 ms     |
| Tick → Redis `ltp`/stream     | < 1 ms     |
| 1m candle close → features    | < 50 ms    |
| Features → prediction + SHAP  | < 5 ms     |
| Prediction → scanner update   | < 20 ms    |
| API read (cached)             | < 5 ms     |

ClickHouse inserts are **batched & async** (10k rows / 1s flush) off the hot path so storage
durability never blocks live inference.
