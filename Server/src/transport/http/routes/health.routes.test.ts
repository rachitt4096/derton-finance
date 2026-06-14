import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerHealthRoutes } from './health.routes.js'

test('health returns 200 when db is up and broker is not stale', async () => {
  const app = Fastify()
  const pool = {
    query: async () => ({ rows: [{ ok: 1 }] }),
  }
  const marketRuntime = {
    getStatus: () => ({
      source: 'upstox',
      status: 'idle',
      lastTickAt: null,
      retryInMs: null,
      error: null,
    }),
  }

  registerHealthRoutes(app, pool as never, marketRuntime as never)

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
  })

  assert.equal(response.statusCode, 200)
  assert.match(response.body, /"ok":true/)

  await app.close()
})

test('health returns 503 when db check fails', async () => {
  const app = Fastify()
  const pool = {
    query: async () => {
      throw new Error('db down')
    },
  }
  const marketRuntime = {
    getStatus: () => ({
      source: 'upstox',
      status: 'idle',
      lastTickAt: null,
      retryInMs: null,
      error: null,
    }),
  }

  registerHealthRoutes(app, pool as never, marketRuntime as never)

  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
  })

  assert.equal(response.statusCode, 503)
  assert.match(response.body, /"db":"down"/)

  await app.close()
})
