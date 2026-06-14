import type { FastifyInstance, FastifyReply } from 'fastify'
import { ZodError } from 'zod'
import type { AppConfig } from '../../../app/config.js'
import type { AuthService } from '../../../auth/authService.js'
import { AdminService, AdminServiceError } from '../../../admin/adminService.js'
import {
  adminCreateUserSchema,
  adminResetPasswordSchema,
  adminUpdateUserSchema,
} from '../../../lib/contracts.js'
import { requireAdminUser } from '../../../lib/httpAuth.js'
import type { MarketRuntime } from '../../../market/marketRuntime.js'

const sendAdminError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof AdminServiceError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }

  if (error instanceof ZodError) {
    return reply.code(400).send({ error: error.issues.map((issue) => issue.message).join('; ') })
  }

  throw error
}

export const registerAdminRoutes = (
  app: FastifyInstance,
  authService: AuthService,
  adminService: AdminService,
  marketRuntime: MarketRuntime,
  config: AppConfig,
) => {
  app.get('/api/admin/overview', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    return {
      ...(await adminService.getOverview()),
      broker: marketRuntime.getStatus(),
      marketRetentionDays: config.MARKET_HISTORY_RETENTION_DAYS,
    }
  })

  app.get('/api/admin/users', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    return {
      items: await adminService.listUsers(),
    }
  })

  app.post('/api/admin/users', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    try {
      const body = adminCreateUserSchema.parse(request.body)
      const id = await adminService.createUser(admin.id, body)
      reply.code(201)
      return { id }
    } catch (error) {
      return sendAdminError(reply, error)
    }
  })

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    try {
      const body = adminUpdateUserSchema.parse(request.body)
      const params = request.params as { id: string }
      await adminService.updateUser(admin.id, params.id, body)
      return { ok: true }
    } catch (error) {
      return sendAdminError(reply, error)
    }
  })

  app.post('/api/admin/users/:id/reset-password', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    try {
      const body = adminResetPasswordSchema.parse(request.body)
      const params = request.params as { id: string }
      await adminService.resetPassword(admin.id, params.id, body.password)
      return { ok: true }
    } catch (error) {
      return sendAdminError(reply, error)
    }
  })

  app.post('/api/admin/users/:id/revoke-sessions', async (request, reply) => {
    const admin = await requireAdminUser(request, reply, authService, config.COOKIE_NAME)
    if (!admin) {
      return
    }

    try {
      const params = request.params as { id: string }
      await adminService.revokeSessions(admin.id, params.id)
      return { ok: true }
    } catch (error) {
      return sendAdminError(reply, error)
    }
  })
}
