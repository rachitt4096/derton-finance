# Derton Intelligence Platform

Production-grade AI market-intelligence data platform for Indian equities (NSE/BSE),
fed by Upstox WebSocket V3. ClickHouse (storage of record) + Redis (real-time tier) +
FastAPI + Celery. Scales to billions of rows; low-latency calibrated inference; SHAP
explainability; walk-forward backtesting; live scanners; EOD reports.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) first** — it has the full design, data flow,
folder map, schemas rationale, latency budget, and K8s topology.

## Quickstart (local)

```bash
cp .env.example .env                       # fill UPSTOX_ACCESS_TOKEN
pip install -e .                           # or: uv pip install -e .
docker compose up -d clickhouse redis minio
python clickhouse/migrations/run_migrations.py     # apply schemas
docker compose up -d                       # bring up services
# train an initial model set once you have history:
python -m services.training.train_xgb 2022-01-01 2026-01-01 v1
```

API at `http://localhost:8080` — try `/health`, `/scanner/15m`, `/explain/15m/NSE:RELIANCE`.

## Component map

| Concern                | Where                                          |
|------------------------|------------------------------------------------|
| Schemas / migrations   | [clickhouse/migrations/](clickhouse/migrations/) |
| Redis keyspace + bus   | [redis/REDIS_ARCHITECTURE.md](redis/REDIS_ARCHITECTURE.md) |
| Ingestion              | [services/ingestion/ws_client.py](services/ingestion/ws_client.py) |
| Candle builder         | [services/candles/builder.py](services/candles/builder.py) |
| Feature engine         | [services/features/engine.py](services/features/engine.py) |
| Inference + SHAP       | [services/inference/](services/inference/)     |
| Scanner                | [services/scanner/engine.py](services/scanner/engine.py) |
| Regime + strategy      | [services/regime/classifier.py](services/regime/classifier.py) |
| Training + registry    | [services/training/](services/training/)       |
| Backtesting            | [services/backtesting/engine.py](services/backtesting/engine.py) |
| Monitoring / drift     | [services/monitoring/drift.py](services/monitoring/drift.py) |
| API                    | [api/main.py](api/main.py)                      |
| Batch schedule         | [workers/celery_app.py](workers/celery_app.py)  |
| Deploy (Docker/K8s)    | [deploy/](deploy/)                              |
| Workflow diagrams      | [docs/diagrams/](docs/diagrams/)                |

## Status

This is an architecture scaffold: schemas, service skeletons with real logic, and
deploy manifests are complete. Two integration points are intentionally stubbed and
marked `NotImplementedError` / `...`: the Upstox protobuf frame decode
([ws_client.decode_frame](services/ingestion/ws_client.py)) and the instrument/sector
master ([services/common/instruments.py](services/common/instruments.py)). Wire those
to your Upstox credentials + instruments master to go live.
