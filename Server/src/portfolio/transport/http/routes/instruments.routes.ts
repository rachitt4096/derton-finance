import type { FastifyInstance } from 'fastify'
import type { InstrumentService } from '../../../instruments/instrumentService.js'

export const registerInstrumentRoutes = (app: FastifyInstance, instrumentService: InstrumentService) => {
  app.get('/api/instruments/search', async (request) => {
    const { q = '', limit = '20' } = request.query as Record<string, string | undefined>
    return {
      items: await instrumentService.search(q ?? '', Number(limit ?? '20')),
    }
  })
}
