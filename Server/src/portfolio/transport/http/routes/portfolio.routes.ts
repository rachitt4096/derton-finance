import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../../../app/config.js'
import type { AuthService } from '../../../auth/authService.js'
import { requireSessionUser } from '../../../lib/httpAuth.js'
import type { MarketRuntime } from '../../../market/marketRuntime.js'
import type { PortfolioService } from '../../../portfolio/portfolioService.js'

export const registerPortfolioRoutes = (
  app: FastifyInstance,
  authService: AuthService,
  portfolioService: PortfolioService,
  marketRuntime: MarketRuntime,
  config: AppConfig,
) => {
  app.get('/api/portfolio/summary', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    return portfolioService.getSummary(user.id, marketRuntime.getLatestPrices())
  })

  app.get('/api/portfolio/holdings', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    return {
      items: await portfolioService.getHoldings(user.id, marketRuntime.getLatestPrices()),
    }
  })

  app.get('/api/portfolio/transactions', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    return {
      items: await portfolioService.listTransactions(user.id),
    }
  })

  app.post('/api/portfolio/transactions', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    const body = request.body as {
      symbol: string
      side: 'BUY' | 'SELL'
      quantity: number
      price: number
      tradedAt?: string
    }

    const id = await portfolioService.createTransaction(user.id, {
      symbol: body.symbol.toUpperCase(),
      side: body.side,
      quantity: Number(body.quantity),
      price: Number(body.price),
      tradedAt: body.tradedAt,
    })

    reply.code(201)
    return { id }
  })

  app.put('/api/portfolio/transactions/:id', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    const body = request.body as { quantity: number; price: number; tradedAt: string }
    const params = request.params as { id: string }
    await portfolioService.updateTransaction(user.id, params.id, {
      quantity: Number(body.quantity),
      price: Number(body.price),
      tradedAt: body.tradedAt,
    })
    return { ok: true }
  })

  app.delete('/api/portfolio/transactions/:id', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    const params = request.params as { id: string }
    await portfolioService.deleteTransaction(user.id, params.id)
    return { ok: true }
  })
}
