import { companyInsightsQuerySchema, marketHistoryQuerySchema } from '../../../lib/contracts.js';
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
        try {
            candles = await upstoxHistoryService.getCandlesBySymbol(query.symbol.toUpperCase(), query.days, query.interval);
        }
        catch {
            candles = await marketRuntime.getCandles(query.symbol.toUpperCase(), query.days, query.interval);
        }
        return {
            symbol: query.symbol.toUpperCase(),
            interval: query.interval,
            days: query.days,
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
