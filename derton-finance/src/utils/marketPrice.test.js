import test from 'node:test'
import assert from 'node:assert/strict'
import { hasFreshFeed, resolveDisplayPrice } from './marketPrice.js'

test('hasFreshFeed only accepts recent live-like feed states', () => {
  assert.equal(hasFreshFeed({ status: 'live', lastSuccessAt: 1_000 }, 61_000), true)
  assert.equal(hasFreshFeed({ status: 'idle', lastSuccessAt: 1_000 }, 61_000), false)
  assert.equal(hasFreshFeed({ status: 'live', lastSuccessAt: 1_000 }, 200_000), false)
})

test('resolveDisplayPrice prefers fresh stream price, then quote, then close', () => {
  assert.equal(
    resolveDisplayPrice({
      livePrice: 105,
      quote: { sessionClose: 103, lastPrice: 104, close: 100 },
      feed: { status: 'live', lastSuccessAt: 1_000 },
      now: 61_000,
    }),
    105,
  )

  assert.equal(
    resolveDisplayPrice({
      livePrice: null,
      quote: { sessionClose: 103, lastPrice: 104, close: 100 },
      feed: { status: 'offline', lastSuccessAt: 1_000 },
      now: 200_000,
    }),
    103,
  )

  assert.equal(
    resolveDisplayPrice({
      livePrice: null,
      quote: { sessionClose: null, lastPrice: 104, close: 100 },
      feed: { status: 'offline', lastSuccessAt: 1_000 },
      now: 200_000,
    }),
    104,
  )

  assert.equal(
    resolveDisplayPrice({
      livePrice: null,
      quote: { lastPrice: null, close: 100 },
      feed: { status: 'offline', lastSuccessAt: 1_000 },
      now: 200_000,
    }),
    100,
  )
})

test('resolveDisplayPrice does not let stale stream prices override quote values', () => {
  assert.equal(
    resolveDisplayPrice({
      livePrice: 1362,
      quote: { sessionClose: 1343.4, lastPrice: 1343.4, close: 1362.1 },
      feed: { status: 'offline', lastSuccessAt: 1_000 },
      now: 200_000,
    }),
    1343.4,
  )
})
