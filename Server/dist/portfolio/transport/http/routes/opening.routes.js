export const registerOpeningRoutes = (app, openingService, marketRuntime) => {
    app.get('/api/opening-window', async () => ({
        items: await openingService.getOpeningRows(marketRuntime.getLatestQuotes(), marketRuntime.getLatestPrices()),
    }));
};
