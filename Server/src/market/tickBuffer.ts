import type { BrokerTick } from '../lib/contracts.js'

export class TickBuffer {
  private readonly latest = new Map<string, BrokerTick>()
  private readonly pending: BrokerTick[] = []

  ingest(tick: BrokerTick) {
    this.latest.set(tick.symbol, tick)
    this.pending.push(tick)
  }

  getLatestPriceMap(symbols?: string[]) {
    const allowed = symbols?.length ? new Set(symbols) : null
    return Object.fromEntries(
      [...this.latest.entries()]
        .filter(([symbol]) => !allowed || allowed.has(symbol))
        .map(([symbol, tick]) => [symbol, tick.price]),
    )
  }

  getLatestTickAt(symbols?: string[]) {
    const allowed = symbols?.length ? new Set(symbols) : null
    const timestamps = [...this.latest.entries()]
      .filter(([symbol]) => !allowed || allowed.has(symbol))
      .map(([, tick]) => tick.recordedAt)
    return timestamps.length ? Math.max(...timestamps) : null
  }

  drainPending() {
    const snapshot = [...this.pending]
    this.pending.length = 0
    return snapshot
  }

  restorePending(ticks: BrokerTick[]) {
    if (!ticks.length) {
      return
    }

    this.pending.unshift(...ticks)
  }

  seed(symbol: string, price: number) {
    this.latest.set(symbol, {
      symbol,
      price,
      recordedAt: Date.now(),
      volume: null,
      payload: { source: 'seed' },
    })
  }

  deleteSymbol(symbol: string) {
    this.latest.delete(symbol)
  }
}
