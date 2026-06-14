import test from 'node:test'
import assert from 'node:assert/strict'
import { getNseMarketWindowState, isNseRegularSessionOpen } from './marketSession.js'

test('getNseMarketWindowState returns pre-open before 9:15 IST on a trading day', () => {
  const state = getNseMarketWindowState(new Date('2026-04-23T03:40:00.000Z'))
  assert.deepEqual(state, { label: 'Pre Open', badgeLabel: 'PRE', className: 'connecting' })
  assert.equal(isNseRegularSessionOpen(new Date('2026-04-23T03:40:00.000Z')), false)
})

test('getNseMarketWindowState returns live during the regular NSE session', () => {
  const state = getNseMarketWindowState(new Date('2026-04-23T06:30:00.000Z'))
  assert.deepEqual(state, { label: 'Live', badgeLabel: 'LIVE', className: 'live' })
  assert.equal(isNseRegularSessionOpen(new Date('2026-04-23T06:30:00.000Z')), true)
})

test('getNseMarketWindowState returns closed after market hours', () => {
  const state = getNseMarketWindowState(new Date('2026-04-23T10:30:00.000Z'))
  assert.deepEqual(state, { label: 'Closed', badgeLabel: 'CLOSE', className: 'offline' })
  assert.equal(isNseRegularSessionOpen(new Date('2026-04-23T10:30:00.000Z')), false)
})

