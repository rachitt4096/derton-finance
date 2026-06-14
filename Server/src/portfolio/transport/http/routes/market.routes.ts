import type { FastifyInstance } from 'fastify'
import { companyInsightsQuerySchema, marketHistoryQuerySchema } from '../../../lib/contracts.js'
import type { CandlePoint } from '../../../lib/contracts.js'
import type { MarketRuntime } from '../../../market/marketRuntime.js'
import type { CompanyInsightService } from '../../../market/companyInsightService.js'
import type { UpstoxQuoteService } from '../../../market/upstoxQuoteService.js'
import type { UpstoxHistoryService } from '../../../market/upstoxHistoryService.js'
import { appendNewerCandles } from '../../../transport/http/routes/market.routes.js'

export const registerMarketRoutes = (
  app: FastifyInstance,
  marketRuntime: MarketRuntime,
  upstoxQuoteService: UpstoxQuoteService,
  upstoxHistoryService: UpstoxHistoryService,
  companyInsightService: CompanyInsightService,
) => {
  app.get('/api/market/quotes', async (request, reply) => {
    const rawSymbols = String((request.query as { symbols?: string }).symbols ?? '')
    const symbols = rawSymbols
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)

    if (!symbols.length) {
      return { items: [] }
    }

    try {
      const items = await upstoxQuoteService.getQuotes(symbols)
      return { items }
    } catch (error) {
      return reply.code(503).send({
        error: error instanceof Error ? error.message : 'Unable to load market quotes',
      })
    }
  })

  app.get('/api/market/history', async (request) => {
    const query = marketHistoryQuerySchema.parse(request.query)
    let candles: CandlePoint[] = []
    const useTickFallback = async () =>
      marketRuntime.getTickCandles(query.symbol.toUpperCase(), query.days, query.interval, {
        date: query.date,
      })

    if (query.date) {
      candles = await marketRuntime.getCandles(query.symbol.toUpperCase(), query.days, query.interval, {
        date: query.date,
      })
    }

    if (!candles.length) {
      try {
        const providerCandles = await upstoxHistoryService.getCandlesBySymbol(
          query.symbol.toUpperCase(),
          query.days,
          query.interval,
          {
            date: query.date,
          },
        )

        candles = providerCandles

        if (providerCandles.length && query.date && query.interval !== '1d') {
          const liveTickCandles = await useTickFallback()
          candles = appendNewerCandles(providerCandles, liveTickCandles)
        }

        if (providerCandles.length) {
          try {
            await marketRuntime.storeCandles(query.symbol.toUpperCase(), query.interval, providerCandles, 'provider')
          } catch {
            // History caching should not fail the primary API response.
          }
        }
      } catch {
        candles = await marketRuntime.getCandles(query.symbol.toUpperCase(), query.days, query.interval, {
          date: query.date,
        })
      }
    }

    return {
      symbol: query.symbol.toUpperCase(),
      interval: query.interval,
      days: query.days,
      date: query.date ?? null,
      candles,
    }
  })

  app.get('/api/market/company-insights', async (request) => {
    const query = companyInsightsQuerySchema.parse(request.query)
    const symbols = query.symbols
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)

    return {
      items: await companyInsightService.getCompanyInsights(symbols, {
        includeHistory: query.includeHistory,
        historyDays: query.historyDays,
      }),
    }
  })
}
