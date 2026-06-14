import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { AdminService } from '../admin/adminService.js';
import { AlertService } from '../alerts/alertService.js';
import { AuthService } from '../auth/authService.js';
import { BrokerCredentialStore } from '../broker/brokerCredentialStore.js';
import { UpstoxAuthService } from '../broker/upstoxAuthService.js';
import { UpstoxBrokerAdapter } from '../broker/upstoxBrokerAdapter.js';
import { createDbPool } from '../db/index.js';
import { ensureSchema, purgeExpiredSessions } from '../db/schema.js';
import { seedDatabase } from '../db/seed.js';
import { FlagService } from '../flags/flagService.js';
import { InstrumentService } from '../instruments/instrumentService.js';
import { MarketRuntime } from '../market/marketRuntime.js';
import { CompanyInsightService } from '../market/companyInsightService.js';
import { OpeningService } from '../market/openingService.js';
import { isNseMarketDataWindowOpen } from '../market/session.js';
import { UpstoxHistoryService } from '../market/upstoxHistoryService.js';
import { UpstoxQuoteService } from '../market/upstoxQuoteService.js';
import { PortfolioService } from '../portfolio/portfolioService.js';
import { registerAuthRoutes } from '../transport/http/routes/auth.routes.js';
import { registerAdminRoutes } from '../transport/http/routes/admin.routes.js';
import { registerBrokerRoutes } from '../transport/http/routes/broker.routes.js';
import { registerFlagRoutes } from '../transport/http/routes/flags.routes.js';
import { registerHealthRoutes } from '../transport/http/routes/health.routes.js';
import { registerInstrumentRoutes } from '../transport/http/routes/instruments.routes.js';
import { registerMarketRoutes } from '../transport/http/routes/market.routes.js';
import { registerOpeningRoutes } from '../transport/http/routes/opening.routes.js';
import { registerPortfolioRoutes } from '../transport/http/routes/portfolio.routes.js';
import { registerWatchlistRoutes } from '../transport/http/routes/watchlists.routes.js';
import { FrontendSocketServer } from '../transport/ws/frontendSocketServer.js';
import { WatchlistService } from '../watchlists/watchlistService.js';
import { loadConfig } from './config.js';
import { registerSecurityHeaders } from './securityHeaders.js';
const SESSION_PURGE_MS = 60 * 60_000;
const INSTRUMENT_SYNC_MS = 12 * 60 * 60_000;
const BACKGROUND_WATCHLIST_REFRESH_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const toError = (error, fallback = 'Unexpected error') => error instanceof Error ? error : new Error(fallback);
const toStatusCode = (error) => {
    const code = error?.statusCode;
    return typeof code === 'number' && code >= 400 && code <= 599 ? code : null;
};
const formatZodIssues = (error) => error.issues
    .map((issue) => {
    const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
})
    .join('; ');
const bootstrap = async () => {
    const config = loadConfig();
    const app = Fastify({
        logger: true,
        requestTimeout: REQUEST_TIMEOUT_MS,
        trustProxy: config.NODE_ENV === 'production',
    });
    app.setErrorHandler((error, request, reply) => {
        if (reply.sent) {
            return;
        }
        if (error instanceof ZodError) {
            reply.code(400).send({ error: formatZodIssues(error) || 'Invalid request payload' });
            return;
        }
        const statusCode = toStatusCode(error);
        if (statusCode && statusCode < 500) {
            reply.code(statusCode).send({ error: toError(error, 'Request failed').message });
            return;
        }
        request.log.error({ err: toError(error) }, 'request failed');
        reply.code(500).send({ error: 'Internal server error' });
    });
    app.setNotFoundHandler((_, reply) => {
        reply.code(404).send({ error: 'Not found' });
    });
    await app.register(cookie);
    registerSecurityHeaders(app);
    const allowedOrigins = new Set(config.APP_ORIGINS);
    await app.register(cors, {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.has(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
        credentials: true,
    });
    const pool = createDbPool(config);
    pool.on('error', (error) => {
        app.log.error({ err: toError(error, 'postgres pool error') }, 'postgres pool error');
    });
    await ensureSchema(pool);
    await seedDatabase(pool, config);
    await purgeExpiredSessions(pool);
    const authService = new AuthService(pool, config);
    const alertService = new AlertService(config);
    const adminService = new AdminService(pool);
    const instrumentService = new InstrumentService(pool);
    const brokerCredentialStore = new BrokerCredentialStore(pool);
    const upstoxAuthService = new UpstoxAuthService(config, brokerCredentialStore);
    const upstoxHistoryService = new UpstoxHistoryService(config, instrumentService, brokerCredentialStore);
    const upstoxQuoteService = new UpstoxQuoteService(config, instrumentService, brokerCredentialStore, upstoxHistoryService);
    const watchlistService = new WatchlistService(pool);
    const portfolioService = new PortfolioService(pool);
    const flagService = new FlagService(pool);
    const openingService = new OpeningService();
    if (config.UPSTOX_INSTRUMENTS_URL) {
        try {
            const synced = await instrumentService.syncFromUpstox(config.UPSTOX_INSTRUMENTS_URL);
            app.log.info({ synced }, 'instrument master synced from Upstox');
        }
        catch (error) {
            app.log.error({ err: toError(error, 'instrument sync failed during startup') }, 'failed to sync instruments at startup');
        }
    }
    const broker = new UpstoxBrokerAdapter(config, instrumentService, brokerCredentialStore);
    const marketRuntime = new MarketRuntime(pool, broker, config, upstoxQuoteService, alertService);
    await marketRuntime.start();
    const companyInsightService = new CompanyInsightService(pool, marketRuntime, upstoxHistoryService);
    registerAuthRoutes(app, authService, config);
    registerAdminRoutes(app, authService, adminService, marketRuntime, config);
    registerHealthRoutes(app, pool, marketRuntime);
    registerBrokerRoutes(app, authService, upstoxAuthService, brokerCredentialStore, marketRuntime, config);
    registerInstrumentRoutes(app, instrumentService);
    registerWatchlistRoutes(app, authService, watchlistService, marketRuntime, config);
    registerMarketRoutes(app, marketRuntime, upstoxQuoteService, upstoxHistoryService, companyInsightService);
    registerPortfolioRoutes(app, authService, portfolioService, marketRuntime, config);
    registerFlagRoutes(app, authService, flagService, config);
    registerOpeningRoutes(app, openingService, marketRuntime);
    const frontendSocketServer = new FrontendSocketServer(app.server, config, authService, watchlistService, marketRuntime);
    frontendSocketServer.start();
    const syncBackgroundMarketCapture = async () => {
        try {
            if (!isNseMarketDataWindowOpen()) {
                await marketRuntime.clearConsumerSymbols('background:watchlists');
                return;
            }
            const symbols = await watchlistService.getAllDefaultWatchlistSymbols();
            await marketRuntime.setConsumerSymbols('background:watchlists', symbols);
            app.log.debug({ symbolCount: symbols.length }, 'background market capture symbols refreshed');
        }
        catch (error) {
            app.log.error({ err: toError(error, 'failed to refresh background market capture') }, 'failed to refresh background market capture');
        }
    };
    await syncBackgroundMarketCapture();
    const runSessionCleanup = async () => {
        try {
            await purgeExpiredSessions(pool);
        }
        catch (error) {
            app.log.error({ err: toError(error, 'failed to purge expired sessions') }, 'failed to purge expired sessions');
        }
    };
    const sessionCleanupInterval = setInterval(() => {
        void runSessionCleanup();
    }, SESSION_PURGE_MS);
    sessionCleanupInterval.unref();
    const runInstrumentSync = async () => {
        if (!config.UPSTOX_INSTRUMENTS_URL) {
            return;
        }
        try {
            const synced = await instrumentService.syncFromUpstox(config.UPSTOX_INSTRUMENTS_URL);
            app.log.info({ synced }, 'instrument master refreshed');
        }
        catch (error) {
            app.log.error({ err: toError(error, 'instrument sync failed') }, 'failed to refresh instrument master');
        }
    };
    const instrumentSyncInterval = config.UPSTOX_INSTRUMENTS_URL
        ? setInterval(() => {
            void runInstrumentSync();
        }, INSTRUMENT_SYNC_MS)
        : null;
    instrumentSyncInterval?.unref();
    const backgroundWatchlistRefreshInterval = setInterval(() => {
        void syncBackgroundMarketCapture();
    }, BACKGROUND_WATCHLIST_REFRESH_MS);
    backgroundWatchlistRefreshInterval.unref();
    let shuttingDown = false;
    const shutdown = async (signal, exitCode) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        app.log.info({ signal }, 'shutting down server');
        clearInterval(sessionCleanupInterval);
        if (instrumentSyncInterval) {
            clearInterval(instrumentSyncInterval);
        }
        clearInterval(backgroundWatchlistRefreshInterval);
        const closeResults = await Promise.allSettled([
            Promise.resolve().then(() => frontendSocketServer.stop()),
            marketRuntime.stop(),
            app.close(),
            pool.end(),
        ]);
        for (const result of closeResults) {
            if (result.status === 'rejected') {
                app.log.error({ err: toError(result.reason, 'shutdown task failed') }, 'shutdown task failed');
            }
        }
        if (typeof exitCode === 'number') {
            process.exit(exitCode);
        }
    };
    process.once('SIGINT', () => {
        void shutdown('SIGINT', 0);
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM', 0);
    });
    process.once('unhandledRejection', (reason) => {
        app.log.error({ err: toError(reason, 'unhandled rejection') }, 'unhandled promise rejection');
        void shutdown('unhandledRejection', 1);
    });
    process.once('uncaughtException', (error) => {
        app.log.error({ err: toError(error, 'uncaught exception') }, 'uncaught exception');
        void shutdown('uncaughtException', 1);
    });
    try {
        await app.listen({
            host: config.HOST,
            port: config.PORT,
        });
        app.log.info({ host: config.HOST, port: config.PORT }, 'server started');
    }
    catch (error) {
        app.log.error({ err: toError(error, 'failed to start server') }, 'failed to start server');
        await shutdown('listen_error', 1);
    }
};
void bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
});
