# Redis Architecture

Redis is the **real-time tier and event bus** — hot state, pub/sub between services, and the
serving cache for the API. It is never the system of record (that's ClickHouse). If Redis is
wiped, the platform rebuilds all of this from ClickHouse on the next ticks.

## Keyspace

| Key                          | Type        | Fields / value                              | TTL      | Writer → Reader |
|------------------------------|-------------|---------------------------------------------|----------|-----------------|
| `ltp:{symbol}`               | hash        | `ltp, ts, vol, chg, chg_pct`                | 1 day    | ingestion → API/scanner |
| `book:{symbol}`              | hash        | `bid, ask, bid_qty, ask_qty, spread`        | 1 day    | ingestion → features |
| `feat:{symbol}`              | hash        | all live `features_1m` columns              | 5 min    | feature engine → inference/scanner |
| `pred:{horizon}:{symbol}`    | hash        | `p_up, conf, exp_move, model_version, ts`   | =horizon | inference → scanner/API |
| `regime:{symbol}`            | string      | regime enum + confidence                    | 30 min   | regime → scanner/API |
| `strat:{symbol}`             | hash        | strategy→score                              | 15 min   | strategy → API |
| `scanner:{horizon}`          | sorted set  | member=symbol, score=ranking score          | 1 min    | scanner → API |
| `signals:active`             | sorted set  | member=signal_id, score=expiry ts           | session  | scanner → API |
| `liq:rank`                   | hash        | symbol→liquidity_rank (nightly)             | 1 day    | EOD job → scanner |
| `model:active:{horizon}`     | string      | active model_version                        | none     | training → inference |
| `health:{service}`           | string      | last-heartbeat ts                           | 30 s     | every service → monitor |

`{horizon}` ∈ `30s | 2m | 15m | eod`. Hash-tag symbols (`ltp:{NSE:RELIANCE}`) when running
Redis Cluster so a symbol's keys colocate on one slot.

## Streams (the event bus)

| Stream                  | Producer        | Consumer group(s)          | maxlen   |
|-------------------------|-----------------|----------------------------|----------|
| `stream:ticks.raw`      | ingestion       | `cg:candles`, `cg:features`| ~2M (approx) |
| `stream:candles.1m`     | candle builder  | `cg:features`, `cg:regime` | ~500k    |
| `stream:features.1m`    | feature engine  | `cg:inference`             | ~500k    |
| `stream:preds.new`      | inference       | `cg:scanner`, `cg:persist` | ~500k    |
| `stream:alerts`         | monitor/any     | `cg:notify`                | ~100k    |

- Each consumer group uses `XREADGROUP` + `XACK`. A reaper runs `XAUTOCLAIM` to recover
  messages whose consumer died (crash safety — at-least-once delivery).
- Streams are capped with `XADD ... MAXLEN ~ N` (approximate trimming, cheap). Durability is
  ClickHouse's job; the stream is a short buffer, not storage.
- Consumers scale horizontally: add pods to a group and the partition rebalances by Redis.

## Why each type

- **Sorted sets for the scanner**: top-N by score is `ZREVRANGE 0 N` in O(log N + N) — the
  scanner overwrites the whole set each cycle with `ZADD`, API reads are tiny.
- **Hashes for live state**: partial field updates (just `ltp`) without re-serializing a blob.
- **Streams over pub/sub**: pub/sub drops messages if no one is listening; streams persist +
  support consumer groups + replay, which we need for crash recovery and backfill.

## Persistence & HA

- AOF `everysec` for crash recovery of hot state; full rebuild from ClickHouse is always
  available as the ultimate fallback.
- Production: Redis Sentinel (3 nodes) or Redis Cluster for sharding the keyspace by symbol.
- Memory guard: `maxmemory` + `allkeys-lru` won't evict streams (they're trimmed by maxlen),
  and all hot keys carry TTLs, so steady-state memory is bounded by `#symbols × key size`.
