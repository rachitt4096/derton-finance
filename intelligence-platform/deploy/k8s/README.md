# Kubernetes deployment

Apply order: `namespace → secrets → statefulsets (CH/Redis/MinIO) → migrations Job →
deployments → cronjobs → keda scalers → ingress`.

```
kubectl apply -f namespace.yaml
kubectl apply -f secrets.yaml          # CH/Redis/MinIO creds, Upstox token
kubectl apply -f clickhouse.yaml       # Altinity operator CRD in prod
kubectl apply -f redis.yaml
kubectl apply -f minio.yaml
kubectl apply -f migrate-job.yaml      # runs run_migrations.py once
kubectl apply -f deployments.yaml
kubectl apply -f cronjobs.yaml
kubectl apply -f keda.yaml
kubectl apply -f ingress.yaml
```

## Topology & scaling

| Workload    | Kind        | Replicas         | Scale signal (KEDA/HPA)              |
|-------------|-------------|------------------|--------------------------------------|
| clickhouse  | StatefulSet | 2 shards × 2 rep | manual / capacity                    |
| redis       | StatefulSet | 3 (Sentinel)     | manual                               |
| minio       | StatefulSet | 4                | manual                               |
| ingestion   | Deployment  | 1 (leader-elect) | none — owns the WS socket            |
| candles     | Deployment  | 2–10             | KEDA: lag on stream:ticks.raw (cg:candles) |
| features    | Deployment  | 2–12             | KEDA: lag on stream:candles.1m (cg:features) |
| inference   | Deployment  | 2–16             | HPA: p95 latency + KEDA stream lag   |
| scanner     | Deployment  | 1 (leader-elect) | none — global ranking                |
| api         | Deployment  | 3–20             | HPA: CPU + req latency               |
| celery      | Deployment  | 2–12             | KEDA: Celery queue length            |
| celery-beat | Deployment  | 1                | none — singleton scheduler           |

Singletons (ingestion, scanner, beat) use a Lease-based leader election so a
rolling restart never doubles the upstream connection or the global ranking.

## Stream-lag autoscaling (KEDA)

```yaml
# keda.yaml (excerpt) — scale feature workers by consumer-group backlog
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: features-scaler, namespace: derton-intel }
spec:
  scaleTargetRef: { name: features }
  minReplicaCount: 2
  maxReplicaCount: 12
  triggers:
    - type: redis-streams
      metadata:
        address: redis.derton-intel:6379
        stream: stream:candles.1m
        consumerGroup: cg:features
        pendingEntriesCount: "5000"   # add a pod per 5k backlog
```
