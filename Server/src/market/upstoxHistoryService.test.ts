import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldUseIntradayEndpoint } from './upstoxHistoryService.js'

test('shouldUseIntradayEndpoint uses intraday endpoint for current IST date and intraday interval', () => {
  const now = new Date('2026-04-23T09:45:00.000Z')

  assert.equal(shouldUseIntradayEndpoint('1m', { date: '2026-04-23' }, now), true)
  assert.equal(shouldUseIntradayEndpoint('1h', { date: '2026-04-23' }, now), true)
})

test('shouldUseIntradayEndpoint does not use intraday endpoint for past dates or daily interval', () => {
  const now = new Date('2026-04-23T09:45:00.000Z')

  assert.equal(shouldUseIntradayEndpoint('1m', { date: '2026-04-22' }, now), false)
  assert.equal(shouldUseIntradayEndpoint('1d', { date: '2026-04-23' }, now), false)
  assert.equal(shouldUseIntradayEndpoint('1m', {}, now), false)
})
