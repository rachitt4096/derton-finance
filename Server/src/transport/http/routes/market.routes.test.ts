import test from 'node:test'
import assert from 'node:assert/strict'
import { appendNewerCandles } from './market.routes.js'

test('appendNewerCandles appends only live candles newer than provider history', () => {
  const providerCandles = [
    {
      time: '2026-04-23T03:45:00.000Z',
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    },
    {
      time: '2026-04-23T03:46:00.000Z',
      open: 100.5,
      high: 102,
      low: 100,
      close: 101,
      volume: 15,
    },
  ]

  const liveCandles = [
    {
      time: '2026-04-23T03:46:00.000Z',
      open: 100.8,
      high: 101.8,
      low: 100.6,
      close: 101.2,
      volume: 5,
    },
    {
      time: '2026-04-23T03:47:00.000Z',
      open: 101.2,
      high: 103,
      low: 101,
      close: 102.5,
      volume: 8,
    },
  ]

  const merged = appendNewerCandles(providerCandles, liveCandles)

  assert.equal(merged.length, 3)
  assert.deepEqual(
    merged.map((candle) => candle.time),
    [
      '2026-04-23T03:45:00.000Z',
      '2026-04-23T03:46:00.000Z',
      '2026-04-23T03:47:00.000Z',
    ],
  )
})

test('appendNewerCandles returns the base candles when live candles are not newer', () => {
  const providerCandles = [
    {
      time: '2026-04-23T03:45:00.000Z',
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 10,
    },
  ]

  const liveCandles = [
    {
      time: '2026-04-23T03:44:00.000Z',
      open: 99,
      high: 100,
      low: 98,
      close: 99.5,
      volume: 5,
    },
    {
      time: '2026-04-23T03:45:00.000Z',
      open: 100,
      high: 101,
      low: 99,
      close: 100.8,
      volume: 6,
    },
  ]

  const merged = appendNewerCandles(providerCandles, liveCandles)

  assert.deepEqual(merged, providerCandles)
})
