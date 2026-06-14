const normalizeSymbols = (symbols) => [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
const toFiniteNumber = (value) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : null;
};
const toFiniteString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isObjectRecord = (value) => typeof value === 'object' && value !== null;
const normalizeFinancials = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((row) => {
        if (!isObjectRecord(row)) {
            return null;
        }
        const label = toFiniteString(row.label);
        const revenueCr = toFiniteNumber(row.revenueCr);
        const profitCr = toFiniteNumber(row.profitCr);
        const eps = toFiniteNumber(row.eps);
        const operatingMarginPct = toFiniteNumber(row.operatingMarginPct);
        if (!label || revenueCr === null || profitCr === null || eps === null || operatingMarginPct === null) {
            return null;
        }
        return {
            label,
            revenueCr,
            profitCr,
            eps,
            operatingMarginPct,
        };
    })
        .filter((row) => Boolean(row));
};
const normalizeCompanyOverview = (metadata) => {
    if (!isObjectRecord(metadata)) {
        return null;
    }
    const rawOverview = isObjectRecord(metadata.companyOverview) ? metadata.companyOverview : metadata;
    const priceBandPercentNumber = toFiniteNumber(rawOverview.priceBandPercent);
    return {
        dataSource: toFiniteString(rawOverview.dataSource) ?? undefined,
        asOf: toFiniteString(rawOverview.asOf) ?? undefined,
        sector: toFiniteString(rawOverview.sector) ?? undefined,
        industry: toFiniteString(rawOverview.industry) ?? undefined,
        description: toFiniteString(rawOverview.description) ?? undefined,
        marketCapCr: toFiniteNumber(rawOverview.marketCapCr) ?? undefined,
        freeFloatMarketCapCr: toFiniteNumber(rawOverview.freeFloatMarketCapCr) ?? undefined,
        applicableMarginRate: toFiniteNumber(rawOverview.applicableMarginRate) ?? undefined,
        deliverablePct: toFiniteNumber(rawOverview.deliverablePct) ?? undefined,
        priceBandPercent: toFiniteString(rawOverview.priceBandPercent) ?? (priceBandPercentNumber !== null ? `${priceBandPercentNumber.toFixed(2)}%` : undefined),
        dailyVolatility: toFiniteNumber(rawOverview.dailyVolatility) ?? undefined,
        annualisedVolatility: toFiniteNumber(rawOverview.annualisedVolatility) ?? undefined,
        status: toFiniteString(rawOverview.status) ?? undefined,
        tradingStatus: toFiniteString(rawOverview.tradingStatus) ?? undefined,
        peRatio: toFiniteNumber(rawOverview.peRatio) ?? undefined,
        adjustedPeRatio: toFiniteNumber(rawOverview.adjustedPeRatio) ?? undefined,
        dividendYield: toFiniteNumber(rawOverview.dividendYield) ?? undefined,
        faceValue: toFiniteNumber(rawOverview.faceValue) ?? undefined,
        bookValue: toFiniteNumber(rawOverview.bookValue) ?? undefined,
        financials: normalizeFinancials(rawOverview.financials),
    };
};
const buildTradedValueHistory = (candles) => candles
    .map((candle) => ({
    time: candle.time,
    close: candle.close,
    volume: candle.volume,
    tradedValue: Number((candle.close * candle.volume).toFixed(2)),
}))
    .filter((row) => Number.isFinite(row.close) &&
    Number.isFinite(row.volume) &&
    Number.isFinite(row.tradedValue) &&
    row.volume > 0)
    .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime())
    .slice(0, 12);
const sanitizeOverviewForClient = (overview) => {
    if (!overview) {
        return {
            safeOverview: null,
            referenceOnly: false,
        };
    }
    if (overview.dataSource !== 'reference_seed') {
        return {
            safeOverview: overview,
            referenceOnly: false,
        };
    }
    return {
        referenceOnly: true,
        safeOverview: {
            ...overview,
            sector: undefined,
            industry: undefined,
            description: undefined,
            marketCapCr: undefined,
            freeFloatMarketCapCr: undefined,
            applicableMarginRate: undefined,
            deliverablePct: undefined,
            priceBandPercent: undefined,
            dailyVolatility: undefined,
            annualisedVolatility: undefined,
            status: undefined,
            tradingStatus: undefined,
            peRatio: undefined,
            adjustedPeRatio: undefined,
            dividendYield: undefined,
            faceValue: undefined,
            bookValue: undefined,
            financials: [],
        },
    };
};
export class CompanyInsightService {
    pool;
    marketRuntime;
    upstoxHistoryService;
    constructor(pool, marketRuntime, upstoxHistoryService) {
        this.pool = pool;
        this.marketRuntime = marketRuntime;
        this.upstoxHistoryService = upstoxHistoryService;
    }
    async getCompanyInsights(symbols, options = {}) {
        const normalizedSymbols = normalizeSymbols(symbols);
        if (!normalizedSymbols.length) {
            return [];
        }
        const result = await this.pool.query(`
        select symbol, company_name, exchange, instrument_key, metadata
        from instruments
        where symbol = any($1::text[])
      `, [normalizedSymbols]);
        const rowBySymbol = new Map(result.rows.map((row) => [row.symbol, row]));
        return Promise.all(normalizedSymbols.map(async (symbol) => {
            const row = rowBySymbol.get(symbol);
            if (!row) {
                return null;
            }
            const companyOverview = normalizeCompanyOverview(row.metadata);
            const { safeOverview, referenceOnly } = sanitizeOverviewForClient(companyOverview);
            const financials = safeOverview?.financials ?? [];
            const latestFinancial = financials[0] ?? null;
            const includeHistory = options.includeHistory ?? false;
            let tradedValueHistory = [];
            if (includeHistory) {
                const historyDays = options.historyDays ?? 30;
                const candles = await this.loadDailyCandles(symbol, historyDays);
                tradedValueHistory = buildTradedValueHistory(candles);
            }
            return {
                symbol: row.symbol,
                companyName: row.company_name,
                exchange: row.exchange,
                instrumentKey: row.instrument_key,
                dataSource: safeOverview?.dataSource ?? null,
                asOf: safeOverview?.asOf ?? null,
                sector: safeOverview?.sector ?? null,
                industry: safeOverview?.industry ?? null,
                description: safeOverview?.description ?? null,
                marketCapCr: safeOverview?.marketCapCr ?? null,
                freeFloatMarketCapCr: safeOverview?.freeFloatMarketCapCr ?? null,
                applicableMarginRate: safeOverview?.applicableMarginRate ?? null,
                deliverablePct: safeOverview?.deliverablePct ?? null,
                priceBandPercent: safeOverview?.priceBandPercent ?? null,
                dailyVolatility: safeOverview?.dailyVolatility ?? null,
                annualisedVolatility: safeOverview?.annualisedVolatility ?? null,
                status: safeOverview?.status ?? null,
                tradingStatus: safeOverview?.tradingStatus ?? null,
                peRatio: safeOverview?.peRatio ?? null,
                adjustedPeRatio: safeOverview?.adjustedPeRatio ?? null,
                dividendYield: safeOverview?.dividendYield ?? null,
                faceValue: safeOverview?.faceValue ?? null,
                bookValue: safeOverview?.bookValue ?? null,
                revenueCr: latestFinancial?.revenueCr ?? null,
                profitCr: latestFinancial?.profitCr ?? null,
                financials,
                referenceOnly,
                tradedValueHistory,
                tradedValueMethod: tradedValueHistory.length ? 'close_x_volume' : null,
            };
        })).then((items) => items.filter((item) => item !== null));
    }
    async loadDailyCandles(symbol, historyDays) {
        try {
            return await this.upstoxHistoryService.getCandlesBySymbol(symbol, historyDays, '1d');
        }
        catch {
            return this.marketRuntime.getCandles(symbol, historyDays, '1d');
        }
    }
}
