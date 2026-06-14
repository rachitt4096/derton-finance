import { requireSessionUser } from '../../../lib/httpAuth.js';
export const registerPortfolioRoutes = (app, authService, portfolioService, marketRuntime, config) => {
    app.get('/api/portfolio/summary', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        return portfolioService.getSummary(user.id, marketRuntime.getLatestPrices());
    });
    app.get('/api/portfolio/holdings', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        return {
            items: await portfolioService.getHoldings(user.id, marketRuntime.getLatestPrices()),
        };
    });
    app.get('/api/portfolio/transactions', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        return {
            items: await portfolioService.listTransactions(user.id),
        };
    });
    app.post('/api/portfolio/transactions', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const body = request.body;
        const id = await portfolioService.createTransaction(user.id, {
            symbol: body.symbol.toUpperCase(),
            side: body.side,
            quantity: Number(body.quantity),
            price: Number(body.price),
            tradedAt: body.tradedAt,
        });
        reply.code(201);
        return { id };
    });
    app.put('/api/portfolio/transactions/:id', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const body = request.body;
        const params = request.params;
        await portfolioService.updateTransaction(user.id, params.id, {
            quantity: Number(body.quantity),
            price: Number(body.price),
            tradedAt: body.tradedAt,
        });
        return { ok: true };
    });
    app.delete('/api/portfolio/transactions/:id', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const params = request.params;
        await portfolioService.deleteTransaction(user.id, params.id);
        return { ok: true };
    });
};
