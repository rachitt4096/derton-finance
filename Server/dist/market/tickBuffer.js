export class TickBuffer {
    latest = new Map();
    pending = [];
    ingest(tick) {
        this.latest.set(tick.symbol, tick);
        this.pending.push(tick);
    }
    getLatestPriceMap(symbols) {
        const allowed = symbols?.length ? new Set(symbols) : null;
        return Object.fromEntries([...this.latest.entries()]
            .filter(([symbol]) => !allowed || allowed.has(symbol))
            .map(([symbol, tick]) => [symbol, tick.price]));
    }
    getLatestTickAt(symbols) {
        const allowed = symbols?.length ? new Set(symbols) : null;
        const timestamps = [...this.latest.entries()]
            .filter(([symbol]) => !allowed || allowed.has(symbol))
            .map(([, tick]) => tick.recordedAt);
        return timestamps.length ? Math.max(...timestamps) : null;
    }
    drainPending() {
        const snapshot = [...this.pending];
        this.pending.length = 0;
        return snapshot;
    }
    restorePending(ticks) {
        if (!ticks.length) {
            return;
        }
        this.pending.unshift(...ticks);
    }
    seed(symbol, price) {
        this.latest.set(symbol, {
            symbol,
            price,
            recordedAt: Date.now(),
            volume: null,
            payload: { source: 'seed' },
        });
    }
    deleteSymbol(symbol) {
        this.latest.delete(symbol);
    }
}
