import { companyInsightsQuerySchema, marketHistoryQuerySchema } from '../../../lib/contracts.js';
const MIN_USABLE_INTRADAY_CANDLES = {
    '1m': 60,
    '5m': 18,
    '15m': 6,
    '1h': 2,
};
const isSparseDatedIntradayCache = (interval, candles) => {
    const minimum = MIN_USABLE_INTRADAY_CANDLES[interval];
    return Number.isFinite(minimum) && candles.length > 0 && candles.length < minimum;
};
const isIntradayInterval = (interval) => interval !== '1d';
export const appendNewerCandles = (baseCandles, liveCandles) => {
    if (!baseCandles.length) {
        return liveCandles;
    }
    if (!liveCandles.length) {
        return baseCandles;
    }
    const lastBaseTime = new Date(baseCandles[baseCandles.length - 1].time).getTime();
    if (!Number.isFinite(lastBaseTime)) {
        return [...baseCandles, ...liveCandles];
    }
    const newerLiveCandles = liveCandles.filter((candle) => new Date(candle.time).getTime() > lastBaseTime);
    return newerLiveCandles.length ? [...baseCandles, ...newerLiveCandles] : baseCandles;
};
export const registerMarketRoutes = (app, marketRuntime, upstoxQuoteService, upstoxHistoryService, companyInsightService) => {
    app.get('/api/market/quotes', async (request, reply) => {
        const rawSymbols = String(request.query.symbols ?? '');
        const symbols = rawSymbols
            .split(',')
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean);
        if (!symbols.length) {
            return { items: [] };
        }
        try {
            const items = await upstoxQuoteService.getQuotes(symbols);
            return { items };
        }
        catch (error) {
            return reply.code(503).send({
                error: error instanceof Error ? error.message : 'Unable to load market quotes',
            });
        }
    });
    app.get('/api/market/history', async (request) => {
        const query = marketHistoryQuerySchema.parse(request.query);
        let candles = [];
        let cachedCandles = [];
        const preferProviderHistory = isIntradayInterval(query.interval);
        const useTickFallback = async () => marketRuntime.getTickCandles(query.symbol.toUpperCase(), query.days, query.interval, {
            date: query.date,
        });
        if (query.date || !preferProviderHistory) {
            cachedCandles = await marketRuntime.getCandles(query.symbol.toUpperCase(), query.days, query.interval, {
                date: query.date,
            });
            candles = cachedCandles;
        }
        const sparseDatedIntradayCache = query.date ? isSparseDatedIntradayCache(query.interval, cachedCandles) : false;
        if (preferProviderHistory ||
            !candles.length ||
            sparseDatedIntradayCache) {
            try {
                const providerCandles = await upstoxHistoryService.getCandlesBySymbol(query.symbol.toUpperCase(), query.days, query.interval, {
                    date: query.date,
                });
                if (providerCandles.length) {
                    let mergedProviderCandles = providerCandles;
                    if (query.date && preferProviderHistory) {
                        const liveTickCandles = await useTickFallback();
                        mergedProviderCandles = appendNewerCandles(providerCandles, liveTickCandles);
                    }
                    try {
                        await marketRuntime.storeCandles(query.symbol.toUpperCase(), query.interval, providerCandles, 'provider');
                    }
                    catch {
                        // History caching should not fail the primary API response.
                    }
                    candles = mergedProviderCandles;
                }
                else if (sparseDatedIntradayCache) {
                    candles = await useTickFallback();
                }
                else if (cachedCandles.length) {
                    candles = cachedCandles;
                }
            }
            catch {
                if (sparseDatedIntradayCache) {
                    candles = await useTickFallback();
                }
                else if (cachedCandles.length) {
                    candles = cachedCandles;
                }
                else {
                    candles = await marketRuntime.getCandles(query.symbol.toUpperCase(), query.days, query.interval, {
                        date: query.date,
                    });
                }
            }
        }
        return {
            symbol: query.symbol.toUpperCase(),
            interval: query.interval,
            days: query.days,
            date: query.date ?? null,
            candles,
        };
    });
    app.get('/api/market/company-insights', async (request) => {
        const query = companyInsightsQuerySchema.parse(request.query);
        const symbols = query.symbols
            .split(',')
            .map((symbol) => symbol.trim().toUpperCase())
            .filter(Boolean);
        return {
            items: await companyInsightService.getCompanyInsights(symbols, {
                includeHistory: query.includeHistory,
                historyDays: query.historyDays,
            }),
        };
    });
};
