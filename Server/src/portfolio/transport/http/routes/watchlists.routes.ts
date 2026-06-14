import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../../../app/config.js'
import type { AuthService } from '../../../auth/authService.js'
import { watchlistUpdateSchema } from '../../../lib/contracts.js'
import { requireSessionUser } from '../../../lib/httpAuth.js'
import type { WatchlistService } from '../../../watchlists/watchlistService.js'
import type { MarketRuntime } from '../../../market/marketRuntime.js'

export const registerWatchlistRoutes = (
  app: FastifyInstance,
  authService: AuthService,
  watchlistService: WatchlistService,
  marketRuntime: MarketRuntime,
  config: AppConfig,
) => {
  app.get('/api/watchlists/default', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    const symbols = await watchlistService.getDefaultWatchlist(user.id)
    await marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols)
    return { name: 'Default', symbols }
  })

  app.put('/api/watchlists/default', async (request, reply) => {
    const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME)
    if (!user) {
      return
    }

    const body = watchlistUpdateSchema.parse(request.body)
    const symbols = await watchlistService.setDefaultWatchlist(user.id, body.symbols)
    await marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols)
    return { name: 'Default', symbols }
  })
}
