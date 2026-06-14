import { TickBuffer } from './tickBuffer.js';
import { isNseTradingSessionOpen, normalizeBrokerStatusForSession } from './session.js';
const intervalToMs = (interval) => ({
    '1m': 60_000,
    '5m': 5 * 60_000,
    '15m': 15 * 60_000,
    '1h': 60 * 60_000,
    '1d': 24 * 60 * 60_000,
})[interval];
const FLUSH_BATCH_SIZE = 500;
const BROKER_WATCHDOG_MS = 10_000;
const STALE_TICK_THRESHOLD_MS = 30_000;
const BROKER_RESTART_BACKOFF_BASE_MS = 5_000;
const BROKER_RESTART_BACKOFF_MAX_MS = 60_000;
const BROKER_RESTART_ALERT_THRESHOLD = 3;
const NSE_TIME_ZONE = 'Asia/Kolkata';
const STORED_CANDLE_INTERVALS = ['1m', '5m', '15m', '1h', '1d'];
const toBucketStartMs = (timestampMs, interval) => Math.floor(timestampMs / intervalToMs(interval)) * intervalToMs(interval);
const toBucketEndMs = (bucketStartMs, interval) => bucketStartMs + intervalToMs(interval) - 1;
const aggregateTicksToCandles = (ticks, interval) => {
    const buckets = new Map();
    for (const tick of ticks) {
        const timestampMs = new Date(tick.recordedAt).getTime();
        if (!Number.isFinite(timestampMs) || !Number.isFinite(tick.price)) {
            continue;
        }
        const bucketStartMs = toBucketStartMs(timestampMs, interval);
        const bucketKey = `${tick.symbol}:${bucketStartMs}`;
        const volume = Number.isFinite(tick.volume) ? Number(tick.volume) : 0;
        const bucketStart = new Date(bucketStartMs).toISOString();
        const tradeTime = new Date(timestampMs).toISOString();
        const existing = buckets.get(bucketKey);
        if (!existing) {
            buckets.set(bucketKey, {
                symbol: tick.symbol,
                interval,
                bucketStart,
                firstTradeAt: tradeTime,
                lastTradeAt: tradeTime,
                open: tick.price,
                high: tick.price,
                low: tick.price,
                close: tick.price,
                volume,
                source: 'broker',
            });
            continue;
        }
        if (timestampMs < new Date(existing.firstTradeAt).getTime()) {
            existing.firstTradeAt = tradeTime;
            existing.open = tick.price;
        }
        if (timestampMs >= new Date(existing.lastTradeAt).getTime()) {
            existing.lastTradeAt = tradeTime;
            existing.close = tick.price;
        }
        existing.high = Math.max(existing.high, tick.price);
        existing.low = Math.min(existing.low, tick.price);
        existing.volume += volume;
    }
    return [...buckets.values()];
};
const normalizeHistoricalCandles = (symbol, interval, candles, source) => candles
    .map((candle) => {
    const bucketStartMs = new Date(candle.time).getTime();
    if (!Number.isFinite(bucketStartMs)) {
        return null;
    }
    return {
        symbol,
        interval,
        bucketStart: new Date(bucketStartMs).toISOString(),
        firstTradeAt: new Date(bucketStartMs).toISOString(),
        lastTradeAt: new Date(toBucketEndMs(bucketStartMs, interval)).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number(candle.volume ?? 0),
        source,
    };
})
    .filter((candle) => Boolean(candle));
export class MarketRuntime {
    pool;
    broker;
    config;
    quoteService;
    alertService;
    tickBuffer = new TickBuffer();
    liveQuotes = new Map();
    consumerSymbols = new Map();
    statusListeners = new Set();
    subscribedSymbols = new Set();
    flushInterval = null;
    cleanupInterval = null;
    watchdogInterval = null;
    brokerRestartInFlight = false;
    brokerRestartAttempts = 0;
    lastBrokerRestartAt = 0;
    status;
    constructor(pool, broker, config, quoteService, alertService) {
        this.pool = pool;
        this.broker = broker;
        this.config = config;
        this.quoteService = quoteService;
        this.alertService = alertService;
        this.status = normalizeBrokerStatusForSession(broker.getStatus());
        this.broker.onTick((tick) => this.onTick(tick));
        this.broker.onStatusChange((status) => {
            this.emitStatus(status);
        });
    }
    async start() {
        try {
            await this.broker.connect();
        }
        catch (error) {
            const message = this.toErrorMessage(error, 'failed to connect to broker');
            this.emitStatus({
                ...this.status,
                status: 'degraded',
                error: message,
            });
            this.logRuntimeError('failed to connect broker during startup', error);
        }
        this.flushInterval = setInterval(() => {
            void this.flushPendingTicks().catch((error) => {
                this.logRuntimeError('failed to flush market ticks', error);
            });
        }, this.config.MARKET_FLUSH_MS);
        this.flushInterval.unref?.();
        this.cleanupInterval = setInterval(() => {
            void this.cleanupExpiredMarketData();
        }, 12 * 60 * 60_000);
        this.cleanupInterval.unref?.();
        this.watchdogInterval = setInterval(() => {
            void this.watchBrokerHealth();
        }, BROKER_WATCHDOG_MS);
        this.watchdogInterval.unref?.();
    }
    async stop() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
        const stopResults = await Promise.allSettled([this.flushPendingTicks(), this.broker.disconnect()]);
        for (const result of stopResults) {
            if (result.status === 'rejected') {
                this.logRuntimeError('runtime shutdown task failed', result.reason);
            }
        }
    }
    async restartBroker() {
        try {
            await this.broker.disconnect();
        }
        catch (error) {
            this.logRuntimeError('broker disconnect failed during restart', error);
        }
        await this.broker.connect();
    }
    getStatus() {
        return this.status;
    }
    getSnapshot() {
        const activeSymbols = [...this.subscribedSymbols];
        const latestTickAt = this.tickBuffer.getLatestTickAt(activeSymbols);
        return {
            ts: Date.now(),
            source: this.status.source,
            marketState: this.status.status,
            prices: this.tickBuffer.getLatestPriceMap(activeSymbols),
            quotes: this.getLatestQuoteMap(activeSymbols),
            snapshotAgeMs: latestTickAt ? Math.max(0, Date.now() - latestTickAt) : null,
            lastTickAt: this.status.lastTickAt,
        };
    }
    getLatestPrices() {
        return this.tickBuffer.getLatestPriceMap();
    }
    getLatestQuotes(symbols) {
        const activeSymbols = symbols?.length ? symbols : [...this.subscribedSymbols];
        return Object.fromEntries(activeSymbols
            .map((symbol) => [symbol, this.liveQuotes.get(symbol)])
            .filter((entry) => Boolean(entry[1])));
    }
    onStatusChange(handler) {
        this.statusListeners.add(handler);
    }
    async setConsumerSymbols(consumerId, symbols) {
        this.consumerSymbols.set(consumerId, new Set(symbols));
        await this.syncSubscriptionsSafe();
    }
    async clearConsumerSymbols(consumerId) {
        this.consumerSymbols.delete(consumerId);
        await this.syncSubscriptionsSafe();
    }
    async getCandles(symbol, days, interval, options = {}) {
        const storedCandles = await this.getStoredCandles(symbol, days, interval, options);
        if (storedCandles.length) {
            return storedCandles;
        }
        return this.getCandlesFromTicks(symbol, days, interval, options);
    }
    async getTickCandles(symbol, days, interval, options = {}) {
        return this.getCandlesFromTicks(symbol, days, interval, options);
    }
    async storeCandles(symbol, interval, candles, source = 'provider') {
        const normalized = normalizeHistoricalCandles(symbol, interval, candles, source);
        if (!normalized.length) {
            return;
        }
        await this.replaceCandles(normalized);
    }
    async getStoredCandles(symbol, days, interval, options = {}) {
        const result = options.date
            ? await this.pool.query(`
            select bucket_start::text, open::text, high::text, low::text, close::text, volume::text
            from market_candles
            where symbol = $1
              and interval = $2
              and timezone('${NSE_TIME_ZONE}', bucket_start)::date = $3::date
            order by bucket_start asc
          `, [symbol, interval, options.date])
            : await this.pool.query(`
            select bucket_start::text, open::text, high::text, low::text, close::text, volume::text
            from market_candles
            where symbol = $1
              and interval = $2
              and bucket_start >= now() - ($3::text || ' days')::interval
            order by bucket_start asc
          `, [symbol, interval, days]);
        return result.rows.map((row) => ({
            time: row.bucket_start,
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
            volume: Number(row.volume ?? 0),
        }));
    }
    async getCandlesFromTicks(symbol, days, interval, options = {}) {
        const result = options.date
            ? await this.pool.query(`
            select price::text, volume::text, recorded_at::text
            from market_ticks
            where symbol = $1
              and timezone('${NSE_TIME_ZONE}', recorded_at)::date = $2::date
            order by recorded_at asc
          `, [symbol, options.date])
            : await this.pool.query(`
            select price::text, volume::text, recorded_at::text
            from market_ticks
            where symbol = $1
              and recorded_at >= now() - ($2::text || ' days')::interval
            order by recorded_at asc
          `, [symbol, days]);
        const bucketMs = intervalToMs(interval);
        const buckets = new Map();
        for (const row of result.rows) {
            const recordedAt = new Date(row.recorded_at).getTime();
            const bucket = Math.floor(recordedAt / bucketMs) * bucketMs;
            const price = Number(row.price);
            const volume = Number(row.volume ?? 0);
            const existing = buckets.get(bucket);
            if (!existing) {
                buckets.set(bucket, {
                    time: new Date(bucket).toISOString(),
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume,
                });
                continue;
            }
            existing.high = Math.max(existing.high, price);
            existing.low = Math.min(existing.low, price);
            existing.close = price;
            existing.volume += volume;
        }
        return [...buckets.values()];
    }
    onTick(tick) {
        this.tickBuffer.ingest(tick);
        if (this.brokerRestartAttempts > 0) {
            this.notifyAlert({
                key: 'broker-feed-recovered',
                severity: 'info',
                title: 'Broker feed recovered',
                message: `Live ticks resumed after ${this.brokerRestartAttempts} watchdog restart attempt(s).`,
                metadata: {
                    symbol: tick.symbol,
                    restartedAt: this.lastBrokerRestartAt ? new Date(this.lastBrokerRestartAt).toISOString() : null,
                    lastTickAt: new Date(tick.recordedAt).toISOString(),
                },
            });
            this.brokerRestartAttempts = 0;
        }
        if (tick.quote) {
            this.mergeQuote(tick.symbol, tick.quote);
        }
    }
    async flushPendingTicks() {
        const ticks = this.tickBuffer.drainPending();
        if (!ticks.length) {
            return;
        }
        for (let offset = 0; offset < ticks.length; offset += FLUSH_BATCH_SIZE) {
            const chunk = ticks.slice(offset, offset + FLUSH_BATCH_SIZE);
            try {
                await this.insertTickChunk(chunk);
            }
            catch (error) {
                this.tickBuffer.restorePending(ticks.slice(offset));
                throw error;
            }
        }
    }
    async syncSubscriptions() {
        const nextSymbols = new Set();
        for (const symbols of this.consumerSymbols.values()) {
            for (const symbol of symbols) {
                nextSymbols.add(symbol);
            }
        }
        const toSubscribe = [...nextSymbols].filter((symbol) => !this.subscribedSymbols.has(symbol));
        const toUnsubscribe = [...this.subscribedSymbols].filter((symbol) => !nextSymbols.has(symbol));
        if (toSubscribe.length) {
            await this.broker.subscribe(toSubscribe);
            toSubscribe.forEach((symbol) => this.subscribedSymbols.add(symbol));
            await this.hydrateQuotes(toSubscribe);
        }
        if (toUnsubscribe.length) {
            await this.broker.unsubscribe(toUnsubscribe);
            toUnsubscribe.forEach((symbol) => {
                this.subscribedSymbols.delete(symbol);
                this.liveQuotes.delete(symbol);
                this.tickBuffer.deleteSymbol(symbol);
            });
        }
    }
    async syncSubscriptionsSafe() {
        try {
            await this.syncSubscriptions();
        }
        catch (error) {
            const message = this.toErrorMessage(error, 'failed to sync market subscriptions');
            this.emitStatus({
                ...this.status,
                status: this.status.status === 'offline' ? 'offline' : 'degraded',
                error: message,
            });
            this.logRuntimeError('failed to sync subscriptions', error);
        }
    }
    emitStatus(status) {
        this.status = normalizeBrokerStatusForSession(status);
        for (const handler of this.statusListeners) {
            try {
                handler(this.status);
            }
            catch (error) {
                this.logRuntimeError('status listener failed', error);
            }
        }
    }
    getLatestQuoteMap(symbols) {
        return this.getLatestQuotes(symbols);
    }
    createEmptyQuote(symbol) {
        return {
            symbol,
            companyName: null,
            exchange: null,
            instrumentKey: null,
            lastPrice: null,
            sessionClose: null,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
            averagePrice: null,
            netChange: null,
            percentChange: null,
            lowerCircuitLimit: null,
            upperCircuitLimit: null,
            totalBuyQuantity: null,
            totalSellQuantity: null,
            lastTradeTime: null,
            timestamp: null,
            yearHigh: null,
            yearLow: null,
            yearHighDate: null,
            yearLowDate: null,
            depth: {
                buy: [],
                sell: [],
            },
        };
    }
    mergeQuote(symbol, patch) {
        const previous = this.liveQuotes.get(symbol) ?? this.createEmptyQuote(symbol);
        this.liveQuotes.set(symbol, {
            ...previous,
            ...patch,
            symbol,
            depth: {
                buy: patch.depth?.buy ?? previous.depth.buy,
                sell: patch.depth?.sell ?? previous.depth.sell,
            },
        });
    }
    async hydrateQuotes(symbols) {
        if (!this.quoteService || !symbols.length) {
            return;
        }
        try {
            const quotes = await this.quoteService.getQuotes(symbols);
            quotes.forEach((quote) => {
                this.mergeQuote(quote.symbol, quote);
            });
        }
        catch {
            // Keep live subscriptions working even if quote bootstrap fails.
        }
    }
    async cleanupExpiredMarketData() {
        try {
            await this.pool.query(`
          delete from market_ticks
          where recorded_at < now() - ($1::text || ' days')::interval
        `, [this.config.MARKET_HISTORY_RETENTION_DAYS]);
            await this.pool.query(`
          delete from market_candles
          where bucket_start < now() - ($1::text || ' days')::interval
        `, [this.config.MARKET_CANDLE_RETENTION_DAYS]);
        }
        catch (error) {
            this.logRuntimeError('failed to purge old market history', error);
        }
    }
    async insertTickChunk(ticks) {
        const values = [];
        const rows = ticks
            .map((tick, index) => {
            const base = index * 4;
            values.push(tick.symbol, tick.price, tick.volume ?? null, new Date(tick.recordedAt).toISOString());
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, null)`;
        })
            .join(', ');
        await this.pool.query(`
        insert into market_ticks (symbol, price, volume, recorded_at, payload)
        values ${rows}
      `, values);
        const storedCandles = STORED_CANDLE_INTERVALS.flatMap((interval) => aggregateTicksToCandles(ticks, interval));
        await this.upsertIncrementalCandles(storedCandles);
    }
    async upsertIncrementalCandles(candles) {
        if (!candles.length) {
            return;
        }
        const values = [];
        const rows = candles
            .map((candle, index) => {
            const base = index * 11;
            values.push(candle.symbol, candle.interval, candle.bucketStart, candle.firstTradeAt, candle.lastTradeAt, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.source);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, now(), now())`;
        })
            .join(', ');
        await this.pool.query(`
        insert into market_candles (
          symbol,
          interval,
          bucket_start,
          first_trade_at,
          last_trade_at,
          open,
          high,
          low,
          close,
          volume,
          source,
          created_at,
          updated_at
        )
        values ${rows}
        on conflict (symbol, interval, bucket_start) do update
        set first_trade_at = least(market_candles.first_trade_at, excluded.first_trade_at),
            last_trade_at = greatest(market_candles.last_trade_at, excluded.last_trade_at),
            open = case
              when excluded.first_trade_at < market_candles.first_trade_at then excluded.open
              else market_candles.open
            end,
            high = greatest(market_candles.high, excluded.high),
            low = least(market_candles.low, excluded.low),
            close = case
              when excluded.last_trade_at >= market_candles.last_trade_at then excluded.close
              else market_candles.close
            end,
            volume = coalesce(market_candles.volume, 0) + coalesce(excluded.volume, 0),
            source = case
              when excluded.source = 'broker' then excluded.source
              else market_candles.source
            end,
            updated_at = now()
      `, values);
    }
    async replaceCandles(candles) {
        if (!candles.length) {
            return;
        }
        const values = [];
        const rows = candles
            .map((candle, index) => {
            const base = index * 11;
            values.push(candle.symbol, candle.interval, candle.bucketStart, candle.firstTradeAt, candle.lastTradeAt, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.source);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, now(), now())`;
        })
            .join(', ');
        await this.pool.query(`
        insert into market_candles (
          symbol,
          interval,
          bucket_start,
          first_trade_at,
          last_trade_at,
          open,
          high,
          low,
          close,
          volume,
          source,
          created_at,
          updated_at
        )
        values ${rows}
        on conflict (symbol, interval, bucket_start) do update
        set first_trade_at = case
              when market_candles.source = 'broker' then market_candles.first_trade_at
              else excluded.first_trade_at
            end,
            last_trade_at = case
              when market_candles.source = 'broker' then market_candles.last_trade_at
              else excluded.last_trade_at
            end,
            open = case
              when market_candles.source = 'broker' then market_candles.open
              else excluded.open
            end,
            high = case
              when market_candles.source = 'broker' then market_candles.high
              else excluded.high
            end,
            low = case
              when market_candles.source = 'broker' then market_candles.low
              else excluded.low
            end,
            close = case
              when market_candles.source = 'broker' then market_candles.close
              else excluded.close
            end,
            volume = case
              when market_candles.source = 'broker' then market_candles.volume
              else excluded.volume
            end,
            source = case
              when market_candles.source = 'broker' then market_candles.source
              else excluded.source
            end,
            updated_at = now()
      `, values);
    }
    logRuntimeError(message, error) {
        const err = error instanceof Error ? error : new Error(this.toErrorMessage(error));
        console.error(`[market-runtime] ${message}`, err);
    }
    toErrorMessage(error, fallback = 'Unknown runtime error') {
        return error instanceof Error ? error.message : fallback;
    }
    async watchBrokerHealth() {
        if (this.brokerRestartInFlight) {
            return;
        }
        if (!isNseTradingSessionOpen()) {
            return;
        }
        const now = Date.now();
        const lastTickAt = this.status.lastTickAt;
        const hasActiveSubscriptions = this.subscribedSymbols.size > 0;
        const hasRecoverableOfflineError = !this.status.error || !/missing upstox_access_token/i.test(this.status.error);
        const tickAgeMs = Number.isFinite(lastTickAt) ? Math.max(0, now - Number(lastTickAt)) : Number.POSITIVE_INFINITY;
        const staleLiveFeed = this.status.status === 'live' && tickAgeMs > STALE_TICK_THRESHOLD_MS;
        const stalledFeed = (this.status.status === 'connecting' || this.status.status === 'degraded') &&
            tickAgeMs > STALE_TICK_THRESHOLD_MS * 2;
        const offlineWithDemand = hasActiveSubscriptions &&
            hasRecoverableOfflineError &&
            this.status.status === 'offline' &&
            tickAgeMs > STALE_TICK_THRESHOLD_MS * 2;
        if (!staleLiveFeed && !stalledFeed && !offlineWithDemand) {
            return;
        }
        const backoffMs = Math.min(BROKER_RESTART_BACKOFF_BASE_MS * 2 ** Math.min(this.brokerRestartAttempts, 5), BROKER_RESTART_BACKOFF_MAX_MS);
        const canRestartNow = now - this.lastBrokerRestartAt >= backoffMs;
        if (!canRestartNow) {
            return;
        }
        const reason = this.status.status === 'live'
            ? `No live tick for ${Math.round(tickAgeMs / 1000)}s during market hours. Restarting broker stream.`
            : this.status.status === 'offline'
                ? 'Broker feed is offline during market hours. Restarting broker stream.'
                : 'Broker feed is stalled during market hours. Restarting broker stream.';
        this.brokerRestartInFlight = true;
        this.lastBrokerRestartAt = now;
        this.brokerRestartAttempts += 1;
        this.notifyAlert({
            key: 'broker-feed-stale',
            severity: 'warning',
            title: 'Broker feed stale - restarting',
            message: reason,
            metadata: {
                status: this.status.status,
                tickAgeMs: Number.isFinite(tickAgeMs) ? Math.round(tickAgeMs) : null,
                restartAttempt: this.brokerRestartAttempts,
                retryInMs: backoffMs,
            },
        });
        if (this.brokerRestartAttempts >= BROKER_RESTART_ALERT_THRESHOLD) {
            this.notifyAlert({
                key: 'broker-restart-threshold',
                severity: 'critical',
                title: 'Broker restart threshold exceeded',
                message: `Watchdog restarted broker ${this.brokerRestartAttempts} times without stable recovery.`,
                metadata: {
                    threshold: BROKER_RESTART_ALERT_THRESHOLD,
                    restartAttempt: this.brokerRestartAttempts,
                    status: this.status.status,
                },
            });
        }
        this.emitStatus({
            ...this.status,
            status: 'connecting',
            error: reason,
            retryInMs: backoffMs,
        });
        try {
            await this.restartBroker();
        }
        catch (error) {
            this.logRuntimeError('broker watchdog restart failed', error);
            this.notifyAlert({
                key: 'broker-restart-failed',
                severity: 'critical',
                title: 'Broker restart failed',
                message: this.toErrorMessage(error, 'Watchdog failed to restart broker stream.'),
                metadata: {
                    restartAttempt: this.brokerRestartAttempts,
                    status: this.status.status,
                },
            });
        }
        finally {
            this.brokerRestartInFlight = false;
        }
    }
    notifyAlert(event) {
        if (!this.alertService) {
            return;
        }
        void this.alertService.notify(event).catch((error) => {
            this.logRuntimeError('failed to deliver runtime alert', error);
        });
    }
}
