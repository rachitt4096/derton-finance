import { ApiClient, MarketDataStreamerV3 } from 'upstox-js-sdk';
const STREAM_SUBSCRIBE_BATCH_SIZE = 200;
const toNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};
const toTimestamp = (value) => {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
        return new Date(num).toISOString();
    }
    return typeof value === 'string' && value ? value : null;
};
const parseFeedEnvelope = (message) => {
    if (typeof message === 'string' || Buffer.isBuffer(message)) {
        try {
            return JSON.parse(message.toString());
        }
        catch {
            return null;
        }
    }
    if (message && typeof message === 'object') {
        return message;
    }
    return null;
};
const pickLiveOhlc = (rows) => {
    const items = Array.isArray(rows) ? rows : [];
    const preferred = ['1d', 'd1', 'day'];
    for (const interval of preferred) {
        const match = items.find((row) => String(row?.interval ?? '').toLowerCase() === interval);
        if (match) {
            return match;
        }
    }
    return items[0] ?? null;
};
const normalizeDepth = (rows) => {
    const items = Array.isArray(rows) ? rows : [];
    return {
        buy: items
            .map((row) => ({
            quantity: toNumber(row?.bidQ) ?? 0,
            price: toNumber(row?.bidP) ?? 0,
            orders: 0,
        }))
            .filter((row) => row.quantity > 0 || row.price > 0),
        sell: items
            .map((row) => ({
            quantity: toNumber(row?.askQ) ?? 0,
            price: toNumber(row?.askP) ?? 0,
            orders: 0,
        }))
            .filter((row) => row.quantity > 0 || row.price > 0),
    };
};
const buildLiveQuotePatch = (symbol, instrumentKey, feed, recordedAt) => {
    const fullFeed = feed.fullFeed ?? null;
    const marketFullFeed = fullFeed?.marketFF ??
        feed.marketFF ??
        null;
    const indexFullFeed = fullFeed?.indexFF ??
        feed.indexFF ??
        null;
    const ltpc = feed.ltpc ??
        marketFullFeed?.ltpc ??
        indexFullFeed?.ltpc ??
        {};
    const ohlcWrapper = marketFullFeed?.marketOHLC ??
        indexFullFeed?.marketOHLC ??
        null;
    const ohlc = pickLiveOhlc(ohlcWrapper?.ohlc);
    const marketLevel = marketFullFeed?.marketLevel ?? null;
    const depth = normalizeDepth(marketLevel?.bidAskQuote);
    const lastPrice = toNumber(ltpc.ltp ?? ltpc.lastPrice ?? ltpc.last_price ?? ltpc.cp);
    const close = toNumber(ltpc.cp ?? ohlc?.close);
    const sessionClose = toNumber(ohlc?.close);
    const netChange = lastPrice !== null && close !== null ? lastPrice - close : null;
    const quotePatch = {
        symbol,
        instrumentKey,
        lastPrice,
        open: toNumber(ohlc?.open),
        high: toNumber(ohlc?.high),
        low: toNumber(ohlc?.low),
        close,
        volume: toNumber(marketFullFeed?.vtt ?? ohlc?.vol ?? ltpc.ltq),
        averagePrice: toNumber(marketFullFeed?.atp),
        netChange,
        percentChange: netChange !== null && close !== null && close !== 0 ? (netChange / close) * 100 : null,
        totalBuyQuantity: toNumber(marketFullFeed?.tbq),
        totalSellQuantity: toNumber(marketFullFeed?.tsq),
        lastTradeTime: toTimestamp(ltpc.ltt),
        timestamp: new Date(recordedAt).toISOString(),
        depth,
    };
    if (sessionClose !== null) {
        quotePatch.sessionClose = sessionClose;
    }
    return quotePatch;
};
export class UpstoxBrokerAdapter {
    config;
    instrumentService;
    credentialStore;
    subscribed = new Set();
    instrumentKeyBySymbol = new Map();
    symbolByInstrumentKey = new Map();
    lastCumulativeVolumeBySymbol = new Map();
    tickHandlers = new Set();
    statusHandlers = new Set();
    streamer = null;
    status = {
        source: 'upstox',
        status: 'idle',
        lastTickAt: null,
        retryInMs: null,
        error: null,
    };
    constructor(config, instrumentService, credentialStore) {
        this.config = config;
        this.instrumentService = instrumentService;
        this.credentialStore = credentialStore;
    }
    async connect() {
        const accessToken = await this.credentialStore.resolveAccessToken('upstox', this.config.UPSTOX_ACCESS_TOKEN);
        if (!accessToken) {
            this.emitStatus({
                ...this.status,
                status: 'offline',
                error: 'Missing UPSTOX_ACCESS_TOKEN',
            });
            return;
        }
        const apiClient = ApiClient.instance;
        const oauth = apiClient.authentications?.OAUTH2;
        if (!oauth) {
            throw new Error('Upstox SDK OAuth client is unavailable');
        }
        oauth.accessToken = accessToken;
        this.streamer?.disconnect?.();
        this.streamer = new MarketDataStreamerV3([], 'full');
        this.streamer.on('open', () => {
            this.emitStatus({
                ...this.status,
                status: this.subscribed.size ? 'connecting' : 'idle',
                error: null,
                retryInMs: null,
            });
            if (this.subscribed.size) {
                void this.subscribe([...this.subscribed]).catch((error) => {
                    this.emitStatus({
                        ...this.status,
                        status: 'degraded',
                        error: this.toErrorMessage(error, 'Failed to restore Upstox subscriptions'),
                    });
                    this.logAdapterError('failed to restore subscriptions after reconnect', error);
                });
            }
        });
        this.streamer.on('message', (message) => {
            try {
                const payload = parseFeedEnvelope(message);
                const feeds = payload?.feeds;
                if (!feeds || typeof feeds !== 'object') {
                    return;
                }
                for (const [instrumentKey, feed] of Object.entries(feeds)) {
                    const rawFeed = typeof feed === 'object' && feed ? feed : {};
                    const quotePatch = buildLiveQuotePatch(this.symbolByInstrumentKey.get(instrumentKey) ?? instrumentKey, instrumentKey, rawFeed, Date.now());
                    const price = quotePatch.lastPrice;
                    if (!Number.isFinite(price)) {
                        continue;
                    }
                    const nextPrice = Number(price);
                    const symbol = this.symbolByInstrumentKey.get(instrumentKey) ?? instrumentKey;
                    const tickState = this.toTickVolume(symbol, rawFeed, quotePatch.volume);
                    if (tickState.shouldSkip || (tickState.volume !== null && tickState.volume <= 0)) {
                        continue;
                    }
                    const tick = {
                        symbol,
                        price: nextPrice,
                        recordedAt: Date.now(),
                        volume: tickState.volume,
                        quote: quotePatch,
                        payload: rawFeed,
                    };
                    this.emitStatus({
                        ...this.status,
                        status: 'live',
                        lastTickAt: tick.recordedAt,
                        error: null,
                    });
                    for (const handler of this.tickHandlers) {
                        try {
                            handler(tick);
                        }
                        catch (error) {
                            this.logAdapterError('tick handler failed', error);
                        }
                    }
                }
            }
            catch (error) {
                this.emitStatus({
                    ...this.status,
                    status: 'degraded',
                    error: this.toErrorMessage(error, 'Failed to process Upstox feed payload'),
                });
                this.logAdapterError('failed to process feed payload', error);
            }
        });
        this.streamer.on('error', (error) => {
            this.emitStatus({
                ...this.status,
                status: 'degraded',
                error: error instanceof Error ? error.message : 'Upstox stream error',
            });
        });
        this.streamer.on('reconnecting', () => {
            this.emitStatus({
                ...this.status,
                status: 'connecting',
                retryInMs: 5000,
            });
        });
        this.streamer.on('autoReconnectStopped', () => {
            this.emitStatus({
                ...this.status,
                status: 'offline',
                error: 'Upstox reconnect attempts exhausted',
            });
        });
        this.streamer.on('close', () => {
            this.emitStatus({
                ...this.status,
                status: 'offline',
                retryInMs: null,
                error: this.status.error,
            });
        });
        this.emitStatus({
            ...this.status,
            status: 'connecting',
            error: null,
            retryInMs: null,
        });
        this.streamer.connect();
    }
    async disconnect() {
        this.streamer?.disconnect?.();
        this.streamer = null;
        this.lastCumulativeVolumeBySymbol.clear();
        this.emitStatus({
            ...this.status,
            status: 'offline',
            retryInMs: null,
        });
    }
    async subscribe(symbols) {
        symbols.forEach((symbol) => this.subscribed.add(symbol));
        if (!this.streamer || !symbols.length) {
            return;
        }
        const records = await this.instrumentService.getBySymbols(symbols);
        const instrumentKeys = records.map((record) => {
            this.instrumentKeyBySymbol.set(record.symbol, record.instrumentKey);
            this.symbolByInstrumentKey.set(record.instrumentKey, record.symbol);
            return record.instrumentKey;
        });
        if (!instrumentKeys.length) {
            this.emitStatus({
                ...this.status,
                status: this.status.status === 'live' ? 'degraded' : this.status.status,
                error: 'No Upstox instrument keys found for the requested symbols',
            });
            return;
        }
        try {
            if (this.status.status !== 'live') {
                this.emitStatus({
                    ...this.status,
                    status: 'connecting',
                    error: null,
                    retryInMs: null,
                });
            }
            for (let offset = 0; offset < instrumentKeys.length; offset += STREAM_SUBSCRIBE_BATCH_SIZE) {
                this.streamer.subscribe?.(instrumentKeys.slice(offset, offset + STREAM_SUBSCRIBE_BATCH_SIZE), 'full');
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Upstox subscribe failed';
            if (/websocket is not open/i.test(message)) {
                this.emitStatus({
                    ...this.status,
                    status: 'connecting',
                    retryInMs: 1000,
                    error: null,
                });
                return;
            }
            throw error;
        }
    }
    async unsubscribe(symbols) {
        symbols.forEach((symbol) => this.subscribed.delete(symbol));
        const instrumentKeys = symbols
            .map((symbol) => this.instrumentKeyBySymbol.get(symbol))
            .filter((value) => Boolean(value));
        instrumentKeys.forEach((instrumentKey) => {
            this.symbolByInstrumentKey.delete(instrumentKey);
        });
        symbols.forEach((symbol) => {
            this.instrumentKeyBySymbol.delete(symbol);
            this.lastCumulativeVolumeBySymbol.delete(symbol);
        });
        if (instrumentKeys.length) {
            try {
                for (let offset = 0; offset < instrumentKeys.length; offset += STREAM_SUBSCRIBE_BATCH_SIZE) {
                    this.streamer?.unsubscribe?.(instrumentKeys.slice(offset, offset + STREAM_SUBSCRIBE_BATCH_SIZE));
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Upstox unsubscribe failed';
                if (!/websocket is not open/i.test(message)) {
                    throw error;
                }
            }
        }
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
            try {
                handler(status);
            }
            catch (error) {
                this.logAdapterError('status listener failed', error);
            }
        }
    }
    logAdapterError(message, error) {
        const err = error instanceof Error ? error : new Error(this.toErrorMessage(error));
        console.error(`[upstox-adapter] ${message}`, err);
    }
    toTickVolume(symbol, feed, quoteVolume) {
        const fullFeed = feed.fullFeed ?? null;
        const marketFullFeed = fullFeed?.marketFF ??
            feed.marketFF ??
            null;
        const indexFullFeed = fullFeed?.indexFF ??
            feed.indexFF ??
            null;
        const ltpc = feed.ltpc ??
            marketFullFeed?.ltpc ??
            indexFullFeed?.ltpc ??
            {};
        const ohlcWrapper = marketFullFeed?.marketOHLC ??
            indexFullFeed?.marketOHLC ??
            null;
        const ohlc = pickLiveOhlc(ohlcWrapper?.ohlc);
        const cumulativeVolume = toNumber(marketFullFeed?.vtt ?? ohlc?.vol);
        if (cumulativeVolume !== null) {
            return this.toVolumeDelta(symbol, cumulativeVolume);
        }
        return {
            shouldSkip: false,
            volume: toNumber(ltpc.ltq ?? quoteVolume),
        };
    }
    toVolumeDelta(symbol, cumulativeVolume) {
        if (!Number.isFinite(cumulativeVolume) || cumulativeVolume < 0) {
            return {
                shouldSkip: false,
                volume: null,
            };
        }
        const previousVolume = this.lastCumulativeVolumeBySymbol.get(symbol);
        if (previousVolume === undefined || !Number.isFinite(previousVolume)) {
            this.lastCumulativeVolumeBySymbol.set(symbol, cumulativeVolume);
            return {
                shouldSkip: false,
                volume: 0,
            };
        }
        if (cumulativeVolume < previousVolume) {
            return {
                shouldSkip: true,
                volume: null,
            };
        }
        this.lastCumulativeVolumeBySymbol.set(symbol, cumulativeVolume);
        return {
            shouldSkip: false,
            volume: cumulativeVolume - previousVolume,
        };
    }
    toErrorMessage(error, fallback = 'Unknown Upstox adapter error') {
        return error instanceof Error ? error.message : fallback;
    }
}
