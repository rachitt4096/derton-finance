import { watchlistUpdateSchema } from '../../../lib/contracts.js';
import { requireSessionUser } from '../../../lib/httpAuth.js';
export const registerWatchlistRoutes = (app, authService, watchlistService, marketRuntime, config) => {
    app.get('/api/watchlists/default', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const symbols = await watchlistService.getDefaultWatchlist(user.id);
        await marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols);
        return { name: 'Default', symbols };
    });
    app.put('/api/watchlists/default', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const body = watchlistUpdateSchema.parse(request.body);
        const symbols = await watchlistService.setDefaultWatchlist(user.id, body.symbols);
        await marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols);
        return { name: 'Default', symbols };
    });
};
