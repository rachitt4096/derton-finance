import { requireAdminUser } from '../../../lib/httpAuth.js';
const buildFrontendRedirect = (config, status, message) => {
    const url = new URL(config.APP_ORIGINS[0]);
    url.searchParams.set('broker', status);
    if (message) {
        url.searchParams.set('brokerMessage', message);
    }
    return url.toString();
};
const readQuery = (request) => request.query;
const readAuthorizedAdmin = async (request, reply, authService, config) => requireAdminUser(request, reply, authService, config.COOKIE_NAME);
export const registerBrokerRoutes = (app, authService, upstoxAuthService, brokerCredentialStore, marketRuntime, config) => {
    app.get('/api/broker/status', async () => {
        const storedCredential = await brokerCredentialStore.get('upstox');
        const hasEnvToken = Boolean(config.UPSTOX_ACCESS_TOKEN.trim());
        const hasStoredToken = Boolean(storedCredential?.accessToken);
        return {
            ...marketRuntime.getStatus(),
            mode: config.BROKER_MODE,
            provider: 'upstox',
            configured: upstoxAuthService.isConfigured(),
            authorizationRequired: !hasEnvToken && !hasStoredToken,
            tokenExpiresAt: storedCredential?.expiresAt?.toISOString() ?? null,
            usingStoredToken: hasStoredToken,
            usingEnvToken: hasEnvToken && !hasStoredToken,
            instrumentsUrl: config.UPSTOX_INSTRUMENTS_URL,
        };
    });
    app.get('/api/broker/upstox/connect-url', async (request, reply) => {
        const user = await readAuthorizedAdmin(request, reply, authService, config);
        if (!user) {
            return;
        }
        if (!upstoxAuthService.isConfigured()) {
            return reply.code(400).send({
                error: 'Missing Upstox OAuth config. Set UPSTOX_API_KEY, UPSTOX_API_SECRET, and UPSTOX_REDIRECT_URI.',
            });
        }
        return {
            authorizationUrl: upstoxAuthService.getAuthorizationUrl(`${user.id}:${Date.now()}`),
        };
    });
    app.get('/api/broker/upstox/connect', async (request, reply) => {
        const user = await readAuthorizedAdmin(request, reply, authService, config);
        if (!user) {
            return;
        }
        if (!upstoxAuthService.isConfigured()) {
            return reply.code(400).send({
                error: 'Missing Upstox OAuth config. Set UPSTOX_API_KEY, UPSTOX_API_SECRET, and UPSTOX_REDIRECT_URI.',
            });
        }
        return reply.redirect(upstoxAuthService.getAuthorizationUrl(`${user.id}:${Date.now()}`));
    });
    app.get('/api/broker/upstox/callback', async (request, reply) => {
        const query = readQuery(request);
        const token = request.cookies[config.COOKIE_NAME];
        const user = token ? await authService.getSessionUser(token) : null;
        if (!user || user.role !== 'admin') {
            return reply.redirect(buildFrontendRedirect(config, 'error', 'Sign in as admin before connecting Upstox.'));
        }
        if (query.error) {
            const message = query.error_description?.trim() || query.error;
            return reply.redirect(buildFrontendRedirect(config, 'error', message));
        }
        if (!query.code?.trim()) {
            return reply.redirect(buildFrontendRedirect(config, 'error', 'Upstox did not return an authorization code.'));
        }
        try {
            await upstoxAuthService.exchangeCode(query.code.trim());
            await marketRuntime.restartBroker();
            return reply.redirect(buildFrontendRedirect(config, 'connected'));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to connect Upstox';
            return reply.redirect(buildFrontendRedirect(config, 'error', message));
        }
    });
    app.post('/api/broker/upstox/disconnect', async (request, reply) => {
        const user = await readAuthorizedAdmin(request, reply, authService, config);
        if (!user) {
            return;
        }
        await upstoxAuthService.disconnect();
        await marketRuntime.restartBroker();
        return { ok: true };
    });
};
