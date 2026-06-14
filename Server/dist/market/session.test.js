import test from 'node:test';
import assert from 'node:assert/strict';
import { isNseMarketDataWindowOpen, isNseTradingSessionOpen, normalizeBrokerStatusForSession } from './session.js';
test('market data window opens during pre-open while trading session remains closed', () => {
    const preOpen = new Date('2026-04-23T03:35:00.000Z');
    assert.equal(isNseMarketDataWindowOpen(preOpen), true);
    assert.equal(isNseTradingSessionOpen(preOpen), false);
});
test('market data window and trading session are both closed after market hours', () => {
    const afterClose = new Date('2026-04-23T10:05:00.000Z');
    assert.equal(isNseMarketDataWindowOpen(afterClose), false);
    assert.equal(isNseTradingSessionOpen(afterClose), false);
});
test('normalizeBrokerStatusForSession downgrades connecting to idle after market close', () => {
    const afterClose = new Date('2026-04-23T10:05:00.000Z');
    assert.deepEqual(normalizeBrokerStatusForSession({
        source: 'upstox',
        status: 'connecting',
        lastTickAt: null,
        retryInMs: 5_000,
        error: null,
    }, afterClose), {
        source: 'upstox',
        status: 'idle',
        lastTickAt: null,
        retryInMs: null,
        error: null,
    });
});
