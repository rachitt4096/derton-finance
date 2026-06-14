import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../../../app/config.js'
import type { AuthService } from '../../../auth/authService.js'
import { requireSessionUser } from '../../../lib/httpAuth.js'
import type { FlagService } from '../../../flags/flagService.js'

export const registerFlagRoutes = (
  app: FastifyInstance,
  authService: AuthService,
  flagService: FlagService,
  config: AppConfig,
) => {
  app.get('/api/flags', async () => ({
    items: await flagService.listFlags(),
  }))

  app.post('/api/flags', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const body = request.body as {
      symbol: string
      company: string
      type: string
      detail: string
      since: string
      severity: string
      status: string
    }
    const id = await flagService.createFlag(body)
    reply.code(201)
    return { id }
  })

  app.put('/api/flags/:id', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const body = request.body as { detail: string; severity: string; status: string }
    const params = request.params as { id: string }
    await flagService.updateFlag(params.id, body)
    return { ok: true }
  })

  app.delete('/api/flags/:id', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const params = request.params as { id: string }
    await flagService.deleteFlag(params.id)
    return { ok: true }
  })
}
