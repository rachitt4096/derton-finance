import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBackendCandles, normalizePreferredHistoryCandles } from './useChartData.js'

test('normalizeBackendCandles snaps intraday candles to timeframe buckets and merges duplicates', () => {
  const candles = normalizeBackendCandles(
    [
      {
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 10,
        time: '2026-04-23T08:55:12.000Z',
      },
      {
        open: 100.5,
        high: 102,
        low: 98,
        close: 101,
        volume: 20,
        time: '2026-04-23T08:55:45.000Z',
      },
      {
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 5,
        time: '2026-04-23T08:56:03.000Z',
      },
    ],
    '1D',
    '2026-04-23',
  )

  assert.equal(candles.length, 2)
  assert.equal(candles[0].t.toISOString(), '2026-04-23T08:55:00.000Z')
  assert.deepEqual(
    { o: candles[0].o, h: candles[0].h, l: candles[0].l, c: candles[0].c, v: candles[0].v },
    { o: 100, h: 102, l: 98, c: 101, v: 30 },
  )
  assert.equal(candles[1].t.toISOString(), '2026-04-23T08:56:00.000Z')
})

test('normalizeBackendCandles keeps only the requested 1D session after bucket normalization', () => {
  const candles = normalizeBackendCandles(
    [
      {
        open: 90,
        high: 91,
        low: 89,
        close: 90,
        volume: 10,
        time: '2026-04-22T09:00:20.000Z',
      },
      {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 20,
        time: '2026-04-23T09:00:20.000Z',
      },
      {
        open: 100,
        high: 102,
        low: 98,
        close: 101,
        volume: 25,
        time: '2026-04-23T09:01:15.000Z',
      },
    ],
    '1D',
    '2026-04-23',
  )

  assert.equal(candles.length, 2)
  assert.ok(candles.every((candle) => candle.t.toISOString().startsWith('2026-04-23')))
  assert.deepEqual(
    candles.map((candle) => candle.t.toISOString()),
    ['2026-04-23T09:00:00.000Z', '2026-04-23T09:01:00.000Z'],
  )
})

test('normalizePreferredHistoryCandles falls back to broader 1D history when the dated payload is empty', () => {
  const candles = normalizePreferredHistoryCandles({
    primaryCandles: [],
    fallbackCandles: [
      {
        open: 90,
        high: 91,
        low: 89,
        close: 90,
        volume: 10,
        time: '2026-04-22T09:00:00.000Z',
      },
      {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 20,
        time: '2026-04-23T09:15:05.000Z',
      },
      {
        open: 101,
        high: 102,
        low: 100,
        close: 101.5,
        volume: 18,
        time: '2026-04-23T09:16:12.000Z',
      },
    ],
    timeframe: '1D',
    selectedDate: '2026-04-23',
  })

  assert.equal(candles.length, 2)
  assert.deepEqual(
    candles.map((candle) => candle.t.toISOString()),
    ['2026-04-23T09:15:00.000Z', '2026-04-23T09:16:00.000Z'],
  )
})

test('normalizePreferredHistoryCandles prefers the dated payload when it is already populated', () => {
  const candles = normalizePreferredHistoryCandles({
    primaryCandles: [
      {
        open: 110,
        high: 112,
        low: 109,
        close: 111,
        volume: 22,
        time: '2026-04-23T10:00:20.000Z',
      },
    ],
    fallbackCandles: [
      {
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 20,
        time: '2026-04-23T09:15:05.000Z',
      },
    ],
    timeframe: '1D',
    selectedDate: '2026-04-23',
  })

  assert.equal(candles.length, 1)
  assert.equal(candles[0].t.toISOString(), '2026-04-23T10:00:00.000Z')
  assert.equal(candles[0].c, 111)
})
