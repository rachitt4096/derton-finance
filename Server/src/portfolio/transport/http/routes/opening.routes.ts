import type { FastifyInstance } from 'fastify'
import type { MarketRuntime } from '../../../market/marketRuntime.js'
import type { OpeningService } from '../../../market/openingService.js'

export const registerOpeningRoutes = (
  app: FastifyInstance,
  openingService: OpeningService,
  marketRuntime: MarketRuntime,
) => {
  app.get('/api/opening-window', async () => ({
    items: await openingService.getOpeningRows(marketRuntime.getLatestQuotes(), marketRuntime.getLatestPrices()),
  }))
}
