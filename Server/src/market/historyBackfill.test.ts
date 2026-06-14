import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHistoryChunks } from './historyBackfill.js'

test('buildHistoryChunks splits 1m requests into monthly-sized windows', () => {
  const chunks = buildHistoryChunks('2026-01-01', '2026-03-15', '1m')

  assert.deepEqual(chunks, [
    { fromDate: '2026-01-01', toDate: '2026-01-30' },
    { fromDate: '2026-01-31', toDate: '2026-03-01' },
    { fromDate: '2026-03-02', toDate: '2026-03-15' },
  ])
})

test('buildHistoryChunks keeps large daily ranges in one chunk', () => {
  const chunks = buildHistoryChunks('2025-01-01', '2025-12-31', '1d')

  assert.equal(chunks.length, 1)
  assert.deepEqual(chunks[0], { fromDate: '2025-01-01', toDate: '2025-12-31' })
})
