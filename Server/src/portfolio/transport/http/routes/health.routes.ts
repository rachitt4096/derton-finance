import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { MarketRuntime } from '../../../market/marketRuntime.js'

export const registerHealthRoutes = (app: FastifyInstance, pool: Pool, marketRuntime: MarketRuntime) => {
  app.get('/api/health', async () => {
    const dbCheck = await pool.query('select 1 as ok')
    return {
      ok: true,
      db: dbCheck.rows[0]?.ok === 1 ? 'up' : 'down',
      broker: marketRuntime.getStatus(),
      timestamp: new Date().toISOString(),
    }
  })
}
