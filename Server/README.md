# Derton Finance Server

Backend service for the Derton Finance analysis terminal.

## What it does

- Authenticates app users with server-owned accounts
- Streams live market snapshots to the frontend over WebSocket
- Stores tick data in PostgreSQL so users can review previous days
- Serves instrument search, watchlists, portfolio, opening-window, and flags APIs
- Uses Upstox as the live market data provider

## Default seeded users

- `ADMIN01` / `admin@2026`

This default is for initial setup only. Production must override it with a strong secret.

You can override the admin email/password with:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`

Production safety toggles:

- `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=lax|strict` protect auth cookies.
- `ALLOW_DEFAULT_ADMIN_PASSWORD=false` (default) blocks startup in production if admin password is still `admin@2026`.
- `APP_ORIGIN` must be a real HTTPS origin in production.
- `BROKER_MODE=upstox` in production requires `UPSTOX_API_KEY`, `UPSTOX_API_SECRET`, and `UPSTOX_REDIRECT_URI`.

## Local development

1. Copy `Server/.env.example` to `Server/.env`
2. Set `POSTGRES_URL`
3. Set `APP_ORIGIN` to your frontend origin (comma-separated if you use multiple dev ports, e.g. `http://localhost:5173,http://localhost:5174`)
4. Start PostgreSQL
5. Run:

```bash
cd Server
set -a
. ./.env
set +a
npm install
npm run dev
```

The server starts on `http://localhost:4000` by default.

## Upstox real-data setup

To run against live Upstox data:

1. Set `BROKER_MODE=upstox`
2. Fill:
   - `UPSTOX_API_KEY`
   - `UPSTOX_API_SECRET`
   - `UPSTOX_REDIRECT_URI`
3. Keep `UPSTOX_INSTRUMENTS_URL` on the NSE JSON feed unless you have a different approved source
4. Restart the backend
5. Sign in as `ADMIN01`
6. Use the `Connect Broker` action in the frontend top bar

The callback route stores the token in PostgreSQL, reconnects the broker runtime, and the frontend keeps using the same WebSocket snapshot contract.

## Watchdog and external alerts

The backend now includes an in-process broker watchdog:

- checks feed freshness every `10s`
- during NSE market hours, restarts broker stream automatically if live ticks are stale (`>30s`)
- escalates to critical alert when restart attempts cross threshold
- marks `/api/health` as unhealthy (`503`) when feed is stale during market hours

External notification channels supported:

- Slack incoming webhook (`ALERT_SLACK_WEBHOOK_URL`)
- WhatsApp via Twilio (`ALERT_WHATSAPP_TWILIO_*`)
- Email webhook (`ALERT_EMAIL_WEBHOOK_URL`)

Enable with:

```bash
ALERTS_ENABLED=true
ALERT_COOLDOWN_MS=300000
```

Notes:

- If `ALERTS_ENABLED=true`, at least one alert channel must be configured.
- Twilio config must be complete if any `ALERT_WHATSAPP_TWILIO_*` value is set.

## Docker

From the repo root:

```bash
docker compose up --build
```

This brings up:

- PostgreSQL on `localhost:5432`
- The backend on `localhost:4000`

For a production-oriented deployment profile, use `docker-compose.prod.yml` from the repo root together with `Server/.env.production.example` as your starting point. The production profile enforces secure cookies, requires an HTTPS app origin, and expects real broker/admin credentials via environment variables.

## Frontend hookup

In `derton-finance/.env`:

```bash
VITE_BACKEND_URL=http://localhost:4000
VITE_BACKEND_WS_URL=
```

When `VITE_BACKEND_URL` is set, the frontend will:

- login against the backend
- open the backend WebSocket
- use stored market history for charts

## Market history

Live ticks are persisted in `market_ticks`, and the backend maintains a durable `market_candles` store for production history reads and provider-cache backfills:

- `GET /api/market/history?symbol=RELIANCE&days=30&interval=1d`
- `GET /api/market/history?symbol=RELIANCE&days=7&interval=1m&date=2026-04-17`

Supported intervals:

- `1m`
- `5m`
- `15m`
- `1h`
- `1d`

Retention is controlled with:

- `MARKET_HISTORY_RETENTION_DAYS` for raw ticks
- `MARKET_CANDLE_RETENTION_DAYS` for aggregated candles

History behavior:

- exact-date requests (`date=YYYY-MM-DD`) prefer the local candle store first
- provider history is cached into `market_candles` after successful fetches
- live ticks continue to be written to `market_ticks` and incrementally upserted into `market_candles`

Backfill usage:

```bash
cd Server
set -a
. ./.env
set +a
npm run backfill:candles -- --symbols=RELIANCE,TCS --from=2026-01-01 --to=2026-01-31 --interval=1m
```

Notes:

- the backfill job pulls Upstox history in provider-safe chunks
- `1m`, `5m`, and `15m` backfills are chunked month-by-month
- imported candles are stored in `market_candles` without overwriting broker-built local candles

## Verification

Backend:

```bash
cd Server
npm test
npm run check
```

Frontend:

```bash
cd derton-finance
npm test
npm run build
```

## Main endpoints

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/session`
- `GET /api/health`
- `GET /api/broker/status`
- `GET /api/broker/upstox/connect-url`
- `GET /api/broker/upstox/connect`
- `GET /api/broker/upstox/callback`
- `POST /api/broker/upstox/disconnect`
- `GET /api/instruments/search?q=reli&limit=20`
- `GET /api/watchlists/default`
- `PUT /api/watchlists/default`
- `GET /api/market/history?symbol=RELIANCE&days=30&interval=1d`
- `GET /api/portfolio/summary`
- `GET /api/portfolio/holdings`
- `GET /api/portfolio/transactions`
- `GET /api/opening-window`
- `GET /api/flags`

## Admin endpoints

Admin-only routes currently available:

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `POST /api/admin/users/:id/reset-password`
- `POST /api/admin/users/:id/revoke-sessions`

Admin writes are recorded in `audit_logs`.

## WebSocket

Frontend socket endpoint:

- `ws://localhost:4000/ws`

Client messages:

```json
{ "type": "session.init" }
{ "type": "watchlist.set", "symbols": ["RELIANCE", "TCS"] }
{ "type": "focus.set", "symbol": "RELIANCE" }
```

Server messages:

```json
{ "type": "session.ready", "user": {}, "watchlist": [], "feedStatus": {} }
{ "type": "market.snapshot", "ts": 0, "marketState": "live", "prices": {}, "snapshotAgeMs": 0 }
{ "type": "feed.status", "source": "upstox", "status": "live", "lastTickAt": 0, "retryInMs": null, "error": null }
```
