export const registerInstrumentRoutes = (app, instrumentService) => {
    app.get('/api/instruments/search', async (request) => {
        const { q = '', limit = '20' } = request.query;
        return {
            items: await instrumentService.search(q ?? '', Number(limit ?? '20')),
        };
    });
};
