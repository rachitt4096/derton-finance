# Derton Finance

## Frontend setup

1. Copy `.env.example` to `.env`.
2. Set `VITE_BACKEND_URL` to your Derton backend URL.
3. Leave `VITE_BACKEND_WS_URL` empty unless you need a custom WebSocket endpoint.
4. Run `npm run dev`.

Production behavior included:

- backend-authenticated login
- backend WebSocket live market snapshots
- live status + latency badge in the top bar
- production build with no local demo-login dependency

For production, point the frontend at the backend and keep only the backend URL settings.
