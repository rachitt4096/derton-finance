# Event-driven workflow diagrams

## 1. Real-time pipeline (tick → scanner)

```mermaid
flowchart LR
    UX[Upstox WS V3] -->|protobuf| ING[Ingestion]
    ING -->|hset| RltP[(Redis ltp/book)]
    ING -->|XADD| S1[[stream:ticks.raw]]
    ING -.batched.-> CHt[(CH market_data.ticks)]

    S1 -->|cg:candles| CB[Candle Builder]
    CB -->|XADD| S2[[stream:candles.1m]]
    CB -.batched.-> CHc[(CH candles_1m)]
    CHc -->|MV rollups| CH5[(candles_5m/15m/daily)]

    S2 -->|cg:features| FE[Feature Engine]
    FE -->|hset| RfeatP[(Redis feat:*)]
    FE -->|XADD| S3[[stream:features.1m]]
    FE -.batched.-> CHf[(CH features_1m)]
    S2 -->|cg:regime| RG[Regime + Strategy]
    RG -.-> CHa[(CH analytics.*)]

    S3 -->|cg:inference| INF[Inference XGBoost + SHAP]
    INF -->|hset| RpredP[(Redis pred:*)]
    INF -->|XADD| S4[[stream:preds.new]]
    INF -.batched.-> CHp[(CH predictions + shap)]

    S4 -->|cg:scanner| SC[Scanner]
    SC -->|ZADD| Rsc[(Redis scanner:*)]
    Rsc --> API[FastAPI]
    RpredP --> API
    API --> FE2[Frontend]
```

Solid = hot path (Redis/streams, sub-second). Dotted = async batched writes to
ClickHouse (durable, off the latency-critical path).

## 2. Batch clock (Celery beat)

```mermaid
flowchart TD
    BEAT[Celery Beat] --> R1[resolve_outcomes/60s]
    BEAT --> EOD[eod_reports 15:50 IST]
    BEAT --> RT[nightly_retrain]
    BEAT --> DR[drift_monitor]
    BEAT --> BT[weekly_backtest]

    R1 -->|join preds↔candles| OUT[(predictions.outcomes)]
    OUT --> DR
    DR -->|PSI/ECE/accuracy| MON[(analytics.model_monitoring)]
    DR -->|breach| ALERT[[stream:alerts]]
    ALERT -.auto-trigger.-> RT
    RT --> REG[(model_registry + MinIO)]
    RT -->|promote| RPTR[(Redis model:active:*)]
    RPTR --> INF[Inference reloads]
    BT --> BTR[(backtesting.*)]
    EOD --> EODR[(analytics.eod_reports)]
```

## 3. Prediction lifecycle (sequence)

```mermaid
sequenceDiagram
    participant FE as Feature Engine
    participant R as Redis
    participant INF as Inference
    participant CH as ClickHouse
    participant SC as Scanner
    participant API as API

    FE->>R: hset feat:{sym}
    FE->>R: XADD stream:features.1m
    INF->>R: XREADGROUP cg:inference
    INF->>R: hgetall feat:{sym}
    INF->>INF: predict + calibrate + SHAP
    INF->>R: hset pred:{h}:{sym} (TTL=h)
    INF->>CH: insert prediction_{h} + shap (batched)
    INF->>R: XADD stream:preds.new
    SC->>R: XREADGROUP cg:scanner
    SC->>R: ZADD scanner:{h} score
    API->>R: ZREVRANGE scanner:{h}
    API-->>API: return top-N
    Note over CH,API: later: resolve_outcomes joins<br/>prediction↔realized return → outcomes
```

## 4. Crash recovery (consumer groups)

```mermaid
flowchart LR
    P[Producer XADD] --> ST[[stream]]
    ST -->|XREADGROUP >| C1[Consumer A]
    ST -->|XREADGROUP >| C2[Consumer B]
    C1 -->|XACK| ST
    C2 -.dies.-> X((crash))
    REAP[Reaper] -->|XAUTOCLAIM min-idle| ST
    REAP -->|reassign pending| C1
```

At-least-once delivery: a message stays pending until `XACK`. If a consumer dies,
the reaper's `XAUTOCLAIM` reassigns its pending messages so nothing is lost.
