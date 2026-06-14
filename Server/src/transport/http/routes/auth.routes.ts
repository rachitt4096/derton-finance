import type { FastifyInstance } from 'fastify'
import { LoginRateLimiter } from '../../../auth/loginRateLimiter.js'
import { loginBodySchema } from '../../../lib/contracts.js'
import type { AuthService } from '../../../auth/authService.js'
import type { AppConfig } from '../../../app/config.js'

const toRetryAfterSeconds = (retryAfterMs: number) => Math.max(1, Math.ceil(retryAfterMs / 1000))

export const registerAuthRoutes = (
  app: FastifyInstance,
  authService: AuthService,
  config: AppConfig,
  loginRateLimiter = new LoginRateLimiter({
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
    maxAttempts: config.AUTH_RATE_LIMIT_MAX_ATTEMPTS,
    blockMs: config.AUTH_RATE_LIMIT_BLOCK_MS,
  }),
) => {
  const baseCookieOptions = {
    httpOnly: true,
    sameSite: config.COOKIE_SAME_SITE,
    path: '/',
    secure: config.COOKIE_SECURE,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  } as const

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBodySchema.parse(request.body)
    const rateLimit = loginRateLimiter.consume(body.identifier)

    reply.header('X-RateLimit-Limit', String(config.AUTH_RATE_LIMIT_MAX_ATTEMPTS))
    reply.header('X-RateLimit-Remaining', String(rateLimit.remaining))

    if (!rateLimit.allowed) {
      const retryAfterSeconds = toRetryAfterSeconds(rateLimit.retryAfterMs)
      reply.header('Retry-After', String(retryAfterSeconds))
      return reply.code(429).send({
        error: `Too many login attempts. Try again in ${retryAfterSeconds} seconds.`,
      })
    }

    const session = await authService.login(body.identifier, body.password)

    if (!session) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    loginRateLimiter.reset(body.identifier)

    reply.setCookie(config.COOKIE_NAME, session.token, {
      ...baseCookieOptions,
      expires: session.expiresAt,
      maxAge: config.SESSION_TTL_HOURS * 60 * 60,
    })

    return {
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME]
    if (token) {
      await authService.logout(token)
    }

    reply.clearCookie(config.COOKIE_NAME, baseCookieOptions)
    return { ok: true }
  })

  app.get('/api/auth/session', async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME]
    if (!token) {
      return reply.code(401).send({ error: 'No active session' })
    }

    const user = await authService.getSessionUser(token)
    if (!user) {
      reply.clearCookie(config.COOKIE_NAME, baseCookieOptions)
      return reply.code(401).send({ error: 'Session expired' })
    }

    return { user }
  })
}
