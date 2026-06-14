import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { LoginRateLimiter } from '../../../auth/loginRateLimiter.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerSecurityHeaders } from '../../../app/securityHeaders.js';
const config = {
    COOKIE_NAME: 'derton_session',
    COOKIE_SECURE: true,
    COOKIE_SAME_SITE: 'lax',
    COOKIE_DOMAIN: undefined,
    SESSION_TTL_HOURS: 24,
    AUTH_RATE_LIMIT_WINDOW_MS: 60_000,
    AUTH_RATE_LIMIT_MAX_ATTEMPTS: 3,
    AUTH_RATE_LIMIT_BLOCK_MS: 300_000,
};
test('login sets a secure httpOnly session cookie and auth routes are no-store', async () => {
    const app = Fastify();
    await app.register(cookie);
    registerSecurityHeaders(app);
    const authService = {
        login: async () => ({
            token: 'token-123',
            expiresAt: new Date('2026-04-19T12:00:00.000Z'),
            user: {
                id: 'user-1',
                email: 'admin@example.com',
                username: 'ADMIN01',
                role: 'admin',
            },
        }),
        logout: async () => undefined,
        getSessionUser: async () => ({
            id: 'user-1',
            email: 'admin@example.com',
            username: 'ADMIN01',
            role: 'admin',
        }),
    };
    registerAuthRoutes(app, authService, config);
    const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
            identifier: 'ADMIN01',
            password: 'secret',
        },
    });
    assert.equal(loginResponse.statusCode, 200);
    const setCookieHeader = Array.isArray(loginResponse.headers['set-cookie'])
        ? loginResponse.headers['set-cookie'][0]
        : loginResponse.headers['set-cookie'] ?? '';
    assert.match(loginResponse.headers['cache-control'] ?? '', /no-store/);
    assert.match(setCookieHeader, /HttpOnly/);
    assert.match(setCookieHeader, /Secure/);
    assert.match(setCookieHeader, /SameSite=Lax/);
    const sessionResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        cookies: {
            [config.COOKIE_NAME]: 'token-123',
        },
    });
    assert.equal(sessionResponse.statusCode, 200);
    assert.match(sessionResponse.headers['cache-control'] ?? '', /no-store/);
    await app.close();
});
test('session returns 401 without a cookie', async () => {
    const app = Fastify();
    await app.register(cookie);
    const authService = {
        login: async () => null,
        logout: async () => undefined,
        getSessionUser: async () => null,
    };
    registerAuthRoutes(app, authService, config);
    const response = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
    });
    assert.equal(response.statusCode, 401);
    assert.match(response.body, /No active session/);
    await app.close();
});
test('login rate limiting returns 429 after repeated failures', async () => {
    const app = Fastify();
    await app.register(cookie);
    const authService = {
        login: async () => null,
        logout: async () => undefined,
        getSessionUser: async () => null,
    };
    const loginRateLimiter = new LoginRateLimiter({
        windowMs: 60_000,
        maxAttempts: 2,
        blockMs: 120_000,
    });
    registerAuthRoutes(app, authService, config, loginRateLimiter);
    const firstAttempt = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
            identifier: 'ADMIN01',
            password: 'wrong-secret',
        },
    });
    const secondAttempt = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
            identifier: 'ADMIN01',
            password: 'wrong-secret',
        },
    });
    assert.equal(firstAttempt.statusCode, 401);
    assert.equal(secondAttempt.statusCode, 429);
    assert.match(secondAttempt.body, /Too many login attempts/i);
    assert.equal(secondAttempt.headers['retry-after'], '120');
    await app.close();
});
