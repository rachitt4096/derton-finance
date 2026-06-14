const HISTORY_BASE_URL = 'https://api.upstox.com/v3/historical-candle';
const INTRADAY_BASE_URL = 'https://api.upstox.com/v3/historical-candle/intraday';
const YEAR_RANGE_CACHE_MS = 6 * 60 * 60 * 1000;
const LATEST_MINUTE_CLOSE_CACHE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_REQUEST_TIMEOUT_MS = 15_000;
const toDateOnly = (value) => value.toISOString().slice(0, 10);
const toIstDateOnly = (value) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : toDateOnly(value);
};
const buildRange = (days, options = {}) => {
    if (options.fromDate || options.toDate) {
        return {
            toDate: options.toDate ?? options.fromDate ?? toDateOnly(new Date()),
            fromDate: options.fromDate ?? options.toDate ?? toDateOnly(new Date()),
        };
    }
    if (options.date) {
        return {
            toDate: options.date,
            fromDate: options.date,
        };
    }
    const now = new Date();
    const toDate = toDateOnly(now);
    const fromDate = toDateOnly(new Date(now.getTime() - days * DAY_MS));
    return { toDate, fromDate };
};
const parseErrorMessage = (payload, status) => payload?.errors?.[0]?.message || `Upstox historical data request failed with HTTP ${status}`;
const mapIntervalConfig = (interval) => {
    switch (interval) {
        case '1m':
            return { unit: 'minutes', value: '1' };
        case '5m':
            return { unit: 'minutes', value: '5' };
        case '15m':
            return { unit: 'minutes', value: '15' };
        case '1h':
            return { unit: 'hours', value: '1' };
        case '1d':
        default:
            return { unit: 'days', value: '1' };
    }
};
export const shouldUseIntradayEndpoint = (interval, options = {}, now = new Date()) => interval !== '1d' && Boolean(options.date) && options.date === toIstDateOnly(now);
const normalizeCandles = (candles = []) => candles
    .map((candle) => ({
    time: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5] ?? 0),
}))
    .filter((candle) => Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close))
    .sort((left, right) => new Date(left.time).getTime() - new Date(right.time).getTime());
export class UpstoxHistoryService {
    config;
    instrumentService;
    credentialStore;
    yearRangeCache = new Map();
    minuteCloseCache = new Map();
    constructor(config, instrumentService, credentialStore) {
        this.config = config;
        this.instrumentService = instrumentService;
        this.credentialStore = credentialStore;
    }
    async getCandlesBySymbol(symbol, days, interval, options = {}) {
        const instruments = await this.instrumentService.getBySymbols([symbol.trim().toUpperCase()]);
        const instrument = instruments[0];
        if (!instrument) {
            return [];
        }
        const accessToken = await this.credentialStore.resolveAccessToken('upstox', this.config.UPSTOX_ACCESS_TOKEN);
        if (!accessToken) {
            throw new Error('Upstox access token is not configured');
        }
        const { unit, value } = mapIntervalConfig(interval);
        const { toDate, fromDate } = buildRange(days, options);
        const endpoint = shouldUseIntradayEndpoint(interval, options)
            ? `${INTRADAY_BASE_URL}/${encodeURIComponent(instrument.instrumentKey)}/${unit}/${value}`
            : `${HISTORY_BASE_URL}/${encodeURIComponent(instrument.instrumentKey)}/${unit}/${value}/${toDate}/${fromDate}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HISTORY_REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(endpoint, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                },
                signal: controller.signal,
            });
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Upstox historical data request timed out');
            }
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
        const text = await response.text();
        let payload = null;
        if (text) {
            try {
                payload = JSON.parse(text);
            }
            catch {
                if (!response.ok) {
                    throw new Error(`Upstox historical data request failed with HTTP ${response.status}`);
                }
                throw new Error('Unexpected Upstox historical data response format');
            }
        }
        if (!response.ok) {
            throw new Error(parseErrorMessage(payload, response.status));
        }
        return normalizeCandles(payload?.data?.candles);
    }
    async getCandlesBySymbolRange(symbol, interval, fromDate, toDate) {
        return this.getCandlesBySymbol(symbol, 1, interval, {
            fromDate,
            toDate,
        });
    }
    async get52WeekRange(symbol) {
        const normalized = symbol.trim().toUpperCase();
        const cached = this.yearRangeCache.get(normalized);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        const candles = await this.getCandlesBySymbol(normalized, 365, '1d');
        if (!candles.length) {
            const empty = {
                yearHigh: null,
                yearLow: null,
                yearHighDate: null,
                yearLowDate: null,
            };
            this.yearRangeCache.set(normalized, {
                expiresAt: Date.now() + YEAR_RANGE_CACHE_MS,
                value: empty,
            });
            return empty;
        }
        let highCandle = candles[0];
        let lowCandle = candles[0];
        for (const candle of candles) {
            if (candle.high > highCandle.high) {
                highCandle = candle;
            }
            if (candle.low < lowCandle.low) {
                lowCandle = candle;
            }
        }
        const value = {
            yearHigh: highCandle.high,
            yearLow: lowCandle.low,
            yearHighDate: highCandle.time,
            yearLowDate: lowCandle.time,
        };
        this.yearRangeCache.set(normalized, {
            expiresAt: Date.now() + YEAR_RANGE_CACHE_MS,
            value,
        });
        return value;
    }
    async getLatestMinuteClose(symbol, days = 7) {
        const normalized = symbol.trim().toUpperCase();
        const cached = this.minuteCloseCache.get(normalized);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }
        const candles = await this.getCandlesBySymbol(normalized, days, '1m');
        const lastCandle = candles.length ? candles[candles.length - 1] : null;
        const value = lastCandle && Number.isFinite(lastCandle.close) ? lastCandle.close : null;
        this.minuteCloseCache.set(normalized, {
            expiresAt: Date.now() + LATEST_MINUTE_CLOSE_CACHE_MS,
            value,
        });
        return value;
    }
}
