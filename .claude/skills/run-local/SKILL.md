---
name: run-local
description: Start, restart, or verify the Derton Finance full local dev stack (FastAPI backend on :4000, Vite frontend on :5177, and the Postgres/ClickHouse/Redis/MinIO docker datastores). Use whenever the user says "run the local", "start the app", "run it again", "the local died/stopped", "restart the server", or wants to develop without deploying. Also use to seed the local watchlist or diagnose why the local dashboard is empty.
---

# Run the Derton Finance local stack

Three layers must all be up: docker datastores → FastAPI backend → Vite frontend.
Background processes and docker containers in this environment are often torn down
between turns, so "run it again" usually means: re-check all three and start whatever is down.

## 0. Check what's already running
```bash
(ss -ltn 2>/dev/null|grep -q ':5177') && echo "vite UP" || echo "vite down"
(ss -ltn 2>/dev/null|grep -q ':4000') && echo "backend UP" || echo "backend down"
cd /home/rachit/dertonmain/Server && docker compose ps --format "{{.Service}}: {{.State}}"
```

## 1. Datastores (docker) — start first, backend depends on them
```bash
cd /home/rachit/dertonmain/Server
docker compose up -d postgres clickhouse redis minio
# wait for postgres before starting the backend, or it crashes on boot:
for i in $(seq 1 25); do docker exec server-postgres-1 pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
```

## 2. Backend (FastAPI, port 4000) — run as a managed background task
Run from `Server/`; it reads `Server/.env` (has the Upstox token, `COOKIE_SECURE=false`,
`APP_ORIGIN` already lists localhost:5177, seeds admin `ADMIN01`). Schema is created on
startup via `init_db()`; boot syncs ~2670 NSE instruments (~30-60s).
```bash
cd /home/rachit/dertonmain/Server
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 4000 --reload
```
Launch this with the Bash tool's `run_in_background: true` (NOT a trailing `&`, which
gets killed). Then wait for health:
```bash
for i in $(seq 1 40); do curl -sf -m3 http://localhost:4000/api/health && break; sleep 3; done
```

## 3. Frontend (Vite, port 5177) — also a managed background task
`derton-finance/.env.local` sets `VITE_BACKEND_URL=` empty so the app uses same-origin
`/api` + `/ws`; `vite.config.js` proxies those to `http://localhost:4000`.
```bash
cd /home/rachit/dertonmain/derton-finance
exec npm run dev
```

## 4. Verify end-to-end
```bash
curl -s -m8 -o /dev/null -w "login HTTP %{http_code}\n" -X POST \
  http://localhost:5177/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"ADMIN01","password":"admin@2026"}'
```
Then tell the user: open http://localhost:5177/ · login **ADMIN01 / admin@2026**.

## Empty dashboard? Seed the watchlist
A fresh local DB has an empty watchlist, so the dashboard renders nothing. Seed it
(log in first to get a cookie, then PUT):
```bash
curl -s -c /tmp/dc.txt -X POST http://localhost:5177/api/auth/login \
  -H 'Content-Type: application/json' -d '{"identifier":"ADMIN01","password":"admin@2026"}'
curl -s -b /tmp/dc.txt -X PUT http://localhost:5177/api/watchlists/default \
  -H 'Content-Type: application/json' \
  -d '{"symbols":["RELIANCE","TATACOMM","TATAPOWER","TCS","INFY","HDFCBANK"]}'
```

## Stop
```bash
pkill -f "uvicorn app.main:app"; pkill -f "vite --host localhost"
cd /home/rachit/dertonmain/Server && docker compose stop   # keeps data in volumes
```

## Notes
- Market data is live only during NSE hours (IST 09:15–15:30); otherwise last-close values.
- Backend dies with `ConnectionRefusedError [Errno 111]` if a datastore isn't up yet — start docker first.
- The existing postgres volume already has the `derton` role matching `.env`; reuse it, don't recreate.
- To preview against the live prod backend instead of local: `DEV_PROXY_TARGET=https://dertonfinance.com npm run dev`.
