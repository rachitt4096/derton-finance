export class OpeningService {
    async getOpeningRows(quotes, latestPrices) {
        return Object.values(quotes)
            .filter((quote) => quote?.symbol)
            .map((quote) => {
            const open = Number.isFinite(quote.open) ? quote.open : null;
            const prevClose = Number.isFinite(quote.close) ? quote.close : null;
            const hasGapInputs = open !== null && prevClose !== null;
            const gap = hasGapInputs ? open - prevClose : null;
            const gapPct = gap !== null && prevClose !== null && prevClose !== 0 ? (gap / prevClose) * 100 : null;
            const livePrice = latestPrices[quote.symbol];
            return {
                symbol: quote.symbol,
                company: quote.companyName ?? quote.symbol,
                preOpen: open,
                prevClose,
                gap,
                gapPct,
                openVolume: Number.isFinite(quote.volume) ? String(quote.volume) : '0',
                currentPrice: Number.isFinite(livePrice) ? livePrice : quote.lastPrice,
                sector: '',
            };
        })
            .sort((left, right) => left.symbol.localeCompare(right.symbol));
    }
}
