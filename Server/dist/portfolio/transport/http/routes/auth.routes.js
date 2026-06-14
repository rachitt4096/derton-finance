import { loginBodySchema } from '../../../lib/contracts.js';
export const registerAuthRoutes = (app, authService, config) => {
    const baseCookieOptions = {
        httpOnly: true,
        sameSite: config.COOKIE_SAME_SITE,
        path: '/',
        secure: config.COOKIE_SECURE,
        ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
    };
    app.post('/api/auth/login', async (request, reply) => {
        const body = loginBodySchema.parse(request.body);
        const session = await authService.login(body.identifier, body.password);
        if (!session) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        reply.setCookie(config.COOKIE_NAME, session.token, {
            ...baseCookieOptions,
            expires: session.expiresAt,
            maxAge: config.SESSION_TTL_HOURS * 60 * 60,
        });
        return {
            user: session.user,
            expiresAt: session.expiresAt.toISOString(),
        };
    });
    app.post('/api/auth/logout', async (request, reply) => {
        const token = request.cookies[config.COOKIE_NAME];
        if (token) {
            await authService.logout(token);
        }
        reply.clearCookie(config.COOKIE_NAME, baseCookieOptions);
        return { ok: true };
    });
    app.get('/api/auth/session', async (request, reply) => {
        const token = request.cookies[config.COOKIE_NAME];
        if (!token) {
            return reply.code(401).send({ error: 'No active session' });
        }
        const user = await authService.getSessionUser(token);
        if (!user) {
            reply.clearCookie(config.COOKIE_NAME, baseCookieOptions);
            return reply.code(401).send({ error: 'Session expired' });
        }
        return { user };
    });
};
