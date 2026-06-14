# Derton Finance — repo guide for Claude

A real-time NSE/BSE trading terminal: React (Vite) frontend + FastAPI backend, live
market data via Upstox WebSocket V3, backed by Postgres / ClickHouse / Redis / MinIO.

## Layout — which code is real
- **`derton-finance/`** — the LIVE frontend (Vite + React 19 + Zustand + Tailwind v4).
  This is what `deploy.sh` builds and ships. **All frontend work goes here.**
- **`Server/`** — the LIVE backend. **`Server/app/`** is the FastAPI app (the real one).
  `Server/src/` is the old Node/TypeScript implementation kept only as reference — do not edit.
- **`src/`** (repo root) — an OLDER standalone frontend variant ("nse-terminal"). NOT deployed,
  has no `package.json`. **Ignore it** unless explicitly asked.
- `deploy.sh` — builds `derton-finance`, copies dist into `Server/frontend_dist`, rsyncs
  `Server/` to the VPS (`/opt/derton-server`), rebuilds the docker image. `.env` is excluded
  from rsync, so all fixes must live in source. Production: https://dertonfinance.com

## Running locally
Use the **`run-local`** skill. Summary: docker datastores → FastAPI on :4000 → Vite on :5177,
login `ADMIN01` / `admin@2026`. The frontend proxies `/api` + `/ws` to the local backend, so
it's same-origin (no CORS/cookie issues). No deploy needed to test.

## Frontend CSS
Recently consolidated from ~15k lines / 7 files (with ~8 duplicate definitions per selector)
down to ~5k lines with each selector defined once: `fonts → themes → base → legacy-terminal →
v5-parity → login → refresh → compatibility → institutional-terminal → screen-overrides`,
imported in that order by `derton-finance/src/index.css`. Foundations first, overrides last,
screen-specific at the end. Keep it that way — one selector, one place.
`derton-finance/public/mock-dashboard.html` is a standalone design concept (open at
`/mock-dashboard.html`).

## Product direction (AI)
The AI layer must be **descriptive, not predictive/advisory** (avoids SEBI advice rules and
hallucinated numbers). Goal: a real-time "What's Happening" narrator that explains observed
market data in plain language. Pattern: a deterministic signal layer computes factual events
(price move, relative volume, VWAP cross, order-book imbalance, etc.) from real data; the LLM
only phrases them ("describe, don't predict"). News claims must cite sources (Tavily/Bedrock).

## Gotchas
- **`.git` is broken** (`git status` fails) — there is currently NO version-control safety net.
  Be careful with deletes; offer to reinitialize git when appropriate.
- Backend crashes on boot with `ConnectionRefusedError [Errno 111]` if a datastore isn't up —
  always start docker datastores before the FastAPI app.
- Background processes (uvicorn/vite) and docker containers often get torn down between turns
  in this environment; expect to restart via the `run-local` skill.
