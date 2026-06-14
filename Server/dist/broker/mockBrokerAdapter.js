import { loadFrontendStocks } from '../lib/frontendData.js';
export class MockBrokerAdapter {
    subscribed = new Set();
    tickHandlers = new Set();
    statusHandlers = new Set();
    intervalId = null;
    latest = new Map();
    status = {
        source: 'mock',
        status: 'simulated',
        lastTickAt: null,
        retryInMs: null,
        error: null,
    };
    async connect() {
        const stocks = await loadFrontendStocks();
        stocks.forEach((stock) => this.latest.set(stock.sym, stock.ltp));
        this.emitStatus({ ...this.status, status: 'simulated', error: null });
        if (!this.intervalId) {
            this.intervalId = setInterval(() => {
                for (const symbol of this.subscribed) {
                    const current = this.latest.get(symbol) ?? 100;
                    const drift = (Math.random() - 0.48) * current * 0.0012;
                    const next = Math.max(1, current + drift);
                    this.latest.set(symbol, next);
                    const tick = {
                        symbol,
                        price: Number(next.toFixed(4)),
                        recordedAt: Date.now(),
                    };
                    this.status = {
                        ...this.status,
                        status: 'simulated',
                        lastTickAt: tick.recordedAt,
                    };
                    for (const handler of this.tickHandlers) {
                        handler(tick);
                    }
                }
                this.emitStatus(this.status);
            }, 350);
        }
    }
    async disconnect() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.emitStatus({
            ...this.status,
            status: 'offline',
            error: null,
        });
    }
    async subscribe(symbols) {
        symbols.forEach((symbol) => this.subscribed.add(symbol));
    }
    async unsubscribe(symbols) {
        symbols.forEach((symbol) => this.subscribed.delete(symbol));
    }
    getStatus() {
        return this.status;
    }
    onTick(handler) {
        this.tickHandlers.add(handler);
    }
    onStatusChange(handler) {
        this.statusHandlers.add(handler);
    }
    emitStatus(status) {
        this.status = status;
        for (const handler of this.statusHandlers) {
            handler(status);
        }
    }
}
