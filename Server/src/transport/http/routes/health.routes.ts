import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { MarketRuntime } from '../../../market/marketRuntime.js'
import { isNseTradingSessionOpen } from '../../../market/session.js'

const HEALTH_STALE_TICK_THRESHOLD_MS = 30_000

export const registerHealthRoutes = (app: FastifyInstance, pool: Pool, marketRuntime: MarketRuntime) => {
  app.get('/api/health', async (_, reply) => {
    let db: 'up' | 'down' = 'down'
    let dbError: string | null = null

    try {
      const dbCheck = await pool.query('select 1 as ok')
      db = dbCheck.rows[0]?.ok === 1 ? 'up' : 'down'
    } catch (error) {
      db = 'down'
      dbError = error instanceof Error ? error.message : 'Database check failed'
    }

    const ok = db === 'up'
    const brokerStatus = marketRuntime.getStatus()
    const lastTickAt = brokerStatus.lastTickAt
    const tickAgeMs = Number.isFinite(lastTickAt) ? Math.max(0, Date.now() - Number(lastTickAt)) : null
    const staleFeed =
      isNseTradingSessionOpen() &&
      brokerStatus.status === 'live' &&
      Number.isFinite(tickAgeMs) &&
      Number(tickAgeMs) > HEALTH_STALE_TICK_THRESHOLD_MS

    reply.code(ok && !staleFeed ? 200 : 503)
    return {
      ok: ok && !staleFeed,
      db,
      dbError,
      broker: {
        ...brokerStatus,
        tickAgeMs,
        stale: staleFeed,
      },
      timestamp: new Date().toISOString(),
    }
  })
}
