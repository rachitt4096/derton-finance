from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api.v1 import (
    admin,
    ai,
    alerts,
    auth,
    broker,
    flags,
    health,
    instruments,
    market,
    portfolio,
    watchlists,
)
from app.api.ws import manager
from app.clickhouse import close_clickhouse, init_clickhouse
from app.config import settings
from app.core.exceptions import AppError
from app.core.logging import logger, setup_logging
from app.core.security import hash_password, make_id
from app.database import async_session_factory, close_db, init_db
from app.minio_client import close_minio, init_minio
from app.services.alert_service import AlertService
from app.services.auth_service import AuthService
from app.services.instrument_service import InstrumentService
from app.services.market_runtime import MarketRuntime
from app.services.session_service import is_nse_market_data_window_open
from app.services.upstox.auto_auth import UpstoxAutoAuth
from app.services.upstox.broker_adapter import UpstoxBrokerAdapter
from app.services.upstox.credential_store import BrokerCredentialStore
from app.services.watchlist_service import WatchlistService

market_runtime: MarketRuntime | None = None
broker_adapter: UpstoxBrokerAdapter | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global market_runtime, broker_adapter

    setup_logging()
    logger.info("Starting Derton Finance Server")

    await init_db()
    await init_clickhouse()
    await init_minio()

    # Seed default admin user if it does not exist
    async with async_session_factory() as db:
        result = await db.execute(
            text("SELECT id FROM users WHERE username = :username"),
            {"username": settings.SEED_ADMIN_USERNAME},
        )
        if not result.one_or_none():
            pwd_hash = hash_password(settings.SEED_ADMIN_PASSWORD)
            await db.execute(
                text(
                    """
                    INSERT INTO users (id, email, username, password_hash, role, is_active, updated_at)
                    VALUES (:id, :email, :username, :pwd, 'admin', true, now())
                    """
                ),
                {
                    "id": make_id("usr"),
                    "email": settings.SEED_ADMIN_EMAIL,
                    "username": settings.SEED_ADMIN_USERNAME,
                    "pwd": pwd_hash,
                },
            )
            await db.execute(
                text(
                    """
                    INSERT INTO watchlists (id, user_id, name, is_default)
                    SELECT :id, users.id, 'Default', true FROM users WHERE username = :username
                    ON CONFLICT (user_id, name) DO UPDATE SET is_default = true
                    """
                ),
                {"id": make_id("wl"), "username": settings.SEED_ADMIN_USERNAME},
            )
            await db.commit()
            logger.info("Default admin user seeded")

    # Build services — use session_factory for long-lived singletons
    credential_store = BrokerCredentialStore(session_factory=async_session_factory)
    instrument_service = InstrumentService(session_factory=async_session_factory)

    alert_service = AlertService()
    broker_adapter = UpstoxBrokerAdapter(credential_store, instrument_service)

    from app.services.upstox.quote_service import UpstoxQuoteService
    quote_service = UpstoxQuoteService(credential_store)

    market_runtime = MarketRuntime(
        alert_service=alert_service,
        broker_adapter=broker_adapter,
        quote_service=quote_service,
    )

    # Wire broker events into market runtime
    broker_adapter.on_tick(market_runtime.ingest_tick)

    def _on_feed_status(status: dict) -> None:
        asyncio.create_task(
            manager.broadcast({
                "type": "feed.status",
                "source": status.get("source", "upstox"),
                "status": status.get("status"),
                "lastTickAt": status.get("lastTickAt"),
                "retryInMs": status.get("retryInMs"),
                "error": status.get("error"),
            })
        )

    broker_adapter.on_status_change(_on_feed_status)

    await broker_adapter.connect()
    await market_runtime.start()

    # Sync instrument master at startup
    if settings.UPSTOX_INSTRUMENTS_URL:
        try:
            synced = await instrument_service.sync_from_upstox(settings.UPSTOX_INSTRUMENTS_URL)
            logger.info("Instrument master synced", count=synced)
        except Exception as exc:
            logger.error("Instrument sync failed at startup", error=str(exc))

    # Initial background watchlist capture
    await _sync_background_watchlists()

    # Start background tasks
    bg_tasks = [
        asyncio.create_task(_session_cleanup_loop()),
        asyncio.create_task(_instrument_sync_loop()),
        asyncio.create_task(_watchlist_capture_loop()),
        asyncio.create_task(_snapshot_broadcast_loop()),
        asyncio.create_task(_auto_auth_loop(credential_store, broker_adapter)),
        asyncio.create_task(_alert_eval_loop(alert_service)),
        asyncio.create_task(_nse_eod_loop()),
    ]

    logger.info("Market runtime and broker adapter started")
    yield

    # Shutdown
    for task in bg_tasks:
        task.cancel()
    await asyncio.gather(*bg_tasks, return_exceptions=True)

    await market_runtime.stop()
    await broker_adapter.disconnect()
    await close_db()
    await close_clickhouse()
    close_minio()
    logger.info("Server shut down")


async def _sync_background_watchlists() -> None:
    """Continuously record (tick-by-tick → ClickHouse) every default-watchlist symbol
    plus the entire market-cap universe (>= 10,000 cr), during the NSE data window."""
    if not market_runtime:
        return
    from app.services.company_master_service import CompanyMasterService

    try:
        if not is_nse_market_data_window_open():
            await market_runtime.clear_consumer_symbols("background:watchlists")
            await market_runtime.clear_consumer_symbols("background:universe")
            return
        async with async_session_factory() as db:
            wl_svc = WatchlistService(db)
            symbols = await wl_svc.get_all_default_watchlist_symbols()
        await market_runtime.set_consumer_symbols("background:watchlists", symbols)

        if settings.RECORD_UNIVERSE_ENABLED:
            master = CompanyMasterService(session_factory=async_session_factory)
            universe = await master.get_all_symbols(limit=settings.RECORD_UNIVERSE_MAX)
            await market_runtime.set_consumer_symbols("background:universe", universe)
            logger.info("Universe capture synced", count=len(universe))
    except Exception as exc:
        logger.error("Background watchlist capture failed", error=str(exc))


async def _session_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(3600)
        try:
            async with async_session_factory() as db:
                auth_svc = AuthService(db)
                await auth_svc.purge_expired_sessions()
                await db.commit()
        except Exception as exc:
            logger.error("Session cleanup failed", error=str(exc))


async def _instrument_sync_loop() -> None:
    while True:
        await asyncio.sleep(12 * 3600)
        if not settings.UPSTOX_INSTRUMENTS_URL:
            continue
        try:
            instrument_service = InstrumentService(session_factory=async_session_factory)
            synced = await instrument_service.sync_from_upstox(settings.UPSTOX_INSTRUMENTS_URL)
            logger.info("Instrument master refreshed", count=synced)
        except Exception as exc:
            logger.error("Instrument sync failed", error=str(exc))


async def _watchlist_capture_loop() -> None:
    while True:
        await asyncio.sleep(60)
        await _sync_background_watchlists()


async def _snapshot_broadcast_loop() -> None:
    interval_s = settings.MARKET_SNAPSHOT_MS / 1000
    while True:
        await asyncio.sleep(interval_s)
        if not market_runtime:
            continue
        try:
            snapshot = market_runtime.get_snapshot()
            await manager.broadcast({"type": "market.snapshot", **snapshot})
        except Exception:
            pass


async def _nse_eod_loop() -> None:
    """Refresh NSE EOD delivery + company master (mkt cap universe) at boot, then daily."""
    from app.services.company_master_service import CompanyMasterService
    from app.services.nse_eod_service import NseEodService

    eod = NseEodService(session_factory=async_session_factory)
    master = CompanyMasterService(session_factory=async_session_factory)
    await asyncio.sleep(30)  # let startup settle
    while True:
        for name, service in (("delivery", eod), ("company-master", master)):
            try:
                await service.fetch_and_store()
            except Exception as exc:  # noqa: BLE001
                logger.error("NSE refresh failed", source=name, error=str(exc))
        await asyncio.sleep(12 * 3600)


async def _alert_eval_loop(alert_service: AlertService) -> None:
    """Evaluate active alert rules against live quotes during market hours."""
    from app.services.alert_rule_service import AlertRuleService, CONDITION_LABELS, condition_met
    from app.services.nifty50 import NIFTY_50
    from app.services.upstox.quote_service import UpstoxQuoteService

    interval_s = 20

    while True:
        await asyncio.sleep(interval_s)
        try:
            if not is_nse_market_data_window_open():
                continue

            rule_service = AlertRuleService(session_factory=async_session_factory)
            rules = await rule_service.active_rules()
            if not rules:
                continue

            # Resolve the symbol universe for each rule, caching watchlist lookups per user.
            watchlist_cache: dict[str, list[str]] = {}

            async def _targets(rule: dict) -> list[str]:
                if rule["scope"] == "symbol":
                    return [rule["symbol"]] if rule["symbol"] else []
                if rule["scope"] == "nifty50":
                    return NIFTY_50
                if rule["scope"] == "watchlist":
                    uid = rule["user_id"]
                    if uid not in watchlist_cache:
                        async with async_session_factory() as db:
                            watchlist_cache[uid] = await WatchlistService(db).get_default_watchlist(uid)
                    return watchlist_cache[uid]
                return []

            all_symbols: set[str] = set()
            rule_targets: dict[str, list[str]] = {}
            for rule in rules:
                targets = await _targets(rule)
                rule_targets[rule["id"]] = targets
                all_symbols.update(targets)

            if not all_symbols:
                continue

            credential_store = BrokerCredentialStore(session_factory=async_session_factory)
            quote_service = UpstoxQuoteService(credential_store)
            quotes = await quote_service.get_quotes(sorted(all_symbols))
            quote_by_symbol = {q["symbol"]: q for q in quotes}

            for rule in rules:
                for symbol in rule_targets.get(rule["id"], []):
                    q = quote_by_symbol.get(symbol)
                    if not q:
                        continue
                    price = q.get("last_price") or q.get("close")
                    pct = q.get("percent_change")
                    if condition_met(rule["condition"], rule["threshold"], price, pct):
                        await rule_service.mark_triggered(rule["id"], symbol, price or 0.0)
                        label = CONDITION_LABELS.get(rule["condition"], rule["condition"])
                        message = f"{symbol} {label} {rule['threshold']} (now {price})"
                        await alert_service.notify({"title": "Price Alert", "message": message, "symbol": symbol})
                        await manager.broadcast({
                            "type": "alert.triggered",
                            "ruleId": rule["id"],
                            "symbol": symbol,
                            "price": price,
                            "message": message,
                        })
                        break  # one trigger per rule
        except Exception as exc:
            logger.error("Alert evaluation failed", error=str(exc))


async def _auto_auth_loop(
    credential_store: BrokerCredentialStore,
    adapter: UpstoxBrokerAdapter | None,
) -> None:
    """Runs daily at 08:30 IST (03:00 UTC) to refresh the Upstox token."""
    import datetime as dt

    auto_auth = UpstoxAutoAuth(credential_store)
    if not auto_auth.is_configured():
        logger.info("Upstox auto-auth not configured — skipping daily refresh loop")
        return

    while True:
        now = dt.datetime.now(dt.timezone.utc)
        # Next 03:00 UTC (= 08:30 IST)
        target = now.replace(hour=3, minute=0, second=0, microsecond=0)
        if target <= now:
            target += dt.timedelta(days=1)
        sleep_s = (target - now).total_seconds()
        logger.info("Upstox auto-auth sleeping until next refresh", seconds=int(sleep_s))
        await asyncio.sleep(sleep_s)

        try:
            await auto_auth.run()
            if adapter:
                await adapter.disconnect()
                await adapter.connect()
            logger.info("Upstox auto-auth: token refreshed and broker reconnected")
        except Exception as exc:
            logger.error("Upstox auto-auth failed", error=str(exc))


app = FastAPI(
    title="Derton Finance Server",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.APP_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = (
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), "
        "microphone=(), payment=(), usb=()"
    )
    path = request.url.path
    if path.startswith(("/api", "/ws")):
        # Strict policy for API/WS responses — these never render HTML.
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
    else:
        # Relaxed policy for the SPA so it can load its bundle, styles and fonts.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "img-src 'self' data: https:; "
            "font-src 'self' https://fonts.gstatic.com; "
            "connect-src 'self' wss: ws: https:; "
            "worker-src 'self' blob:; "
            "frame-ancestors 'none'; base-uri 'self'"
        )
    if path.startswith(("/api/auth", "/api/broker")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.message})


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


app.include_router(auth.router)
app.include_router(health.router)
app.include_router(instruments.router)
app.include_router(market.router)
app.include_router(market.compat_router)
app.include_router(watchlists.router)
app.include_router(portfolio.router)
app.include_router(flags.router)
app.include_router(broker.router)
app.include_router(admin.router)
app.include_router(ai.router)
app.include_router(alerts.router)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    conn_id = await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "session.init":
                # Accept token from HTTP cookie (preferred) or message body (fallback)
                cookie = (
                    websocket.cookies.get(settings.COOKIE_NAME)
                    or data.get("cookie")
                    or data.get("token")
                )
                user = None
                if cookie:
                    async with async_session_factory() as db:
                        auth_svc = AuthService(db)
                        user = await auth_svc.get_session_user(cookie)

                if not user:
                    await manager.send_personal_by_id(conn_id, {
                        "type": "error",
                        "message": "Unauthorized socket session",
                    })
                    await websocket.close()
                    return

                manager.set_user(conn_id, user["id"])

                if market_runtime:
                    async with async_session_factory() as db:
                        wl_svc = WatchlistService(db)
                        watchlist = await wl_svc.get_default_watchlist(user["id"])
                    await market_runtime.set_consumer_symbols(f"watchlist:{user['id']}", watchlist)
                    await manager.send_personal_by_id(conn_id, {
                        "type": "session.ready",
                        "user": user,
                        "watchlist": watchlist,
                        "feedStatus": market_runtime.get_status(),
                    })
                    await manager.send_personal_by_id(conn_id, {
                        "type": "market.snapshot",
                        **market_runtime.get_snapshot(),
                    })

            elif msg_type == "watchlist.set":
                # Persist + resubscribe
                token = websocket.cookies.get(settings.COOKIE_NAME)
                if token and market_runtime:
                    async with async_session_factory() as db:
                        auth_svc = AuthService(db)
                        user = await auth_svc.get_session_user(token)
                    if user:
                        async with async_session_factory() as db:
                            wl_svc = WatchlistService(db)
                            symbols = await wl_svc.set_default_watchlist(
                                user["id"], data.get("symbols", [])
                            )
                        await market_runtime.set_consumer_symbols(
                            f"watchlist:{user['id']}", symbols
                        )
                        await manager.send_personal_by_id(conn_id, {
                            "type": "session.ready",
                            "user": user,
                            "watchlist": symbols,
                            "feedStatus": market_runtime.get_status(),
                        })

            elif msg_type == "symbols.set":
                symbols = [s.upper() for s in data.get("symbols", []) if s]
                manager.set_symbols(conn_id, symbols)
                if market_runtime:
                    await market_runtime.set_consumer_symbols(f"screen:{conn_id}", symbols)
                    await manager.send_personal_by_id(conn_id, {
                        "type": "market.snapshot",
                        **market_runtime.get_snapshot(),
                    })

            elif msg_type == "focus.set":
                symbol = (data.get("symbol") or "").upper()
                if symbol and market_runtime:
                    await market_runtime.set_consumer_symbols(f"focus:{conn_id}", [symbol])

            elif msg_type == "ping":
                await manager.send_personal_by_id(conn_id, {"type": "pong"})

    except WebSocketDisconnect:
        manager.disconnect(conn_id)
        if market_runtime:
            await asyncio.gather(
                market_runtime.clear_consumer_symbols(f"focus:{conn_id}"),
                market_runtime.clear_consumer_symbols(f"screen:{conn_id}"),
                return_exceptions=True,
            )
    except Exception:
        manager.disconnect(conn_id)
        if market_runtime:
            await asyncio.gather(
                market_runtime.clear_consumer_symbols(f"focus:{conn_id}"),
                market_runtime.clear_consumer_symbols(f"screen:{conn_id}"),
                return_exceptions=True,
            )


_DIST = os.path.normpath(
    os.environ.get("FRONTEND_DIST_PATH")
    or os.path.join(os.path.dirname(__file__), "..", "frontend_dist")
)

if os.path.isdir(_DIST):
    _assets = os.path.join(_DIST, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        return FileResponse(os.path.join(_DIST, "index.html"))
