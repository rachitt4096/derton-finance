import { z } from 'zod';
import { requireSessionUser } from '../../../lib/httpAuth.js';
const transactionParamsSchema = z.object({
    id: z.string().min(1),
});
const transactionCreateBodySchema = z.object({
    symbol: z.string().trim().min(1),
    side: z.enum(['BUY', 'SELL']),
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    tradedAt: z.string().trim().min(1).optional(),
});
const transactionUpdateBodySchema = z.object({
    quantity: z.coerce.number().positive(),
    price: z.coerce.number().positive(),
    tradedAt: z.string().trim().min(1),
});
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
        const body = transactionCreateBodySchema.parse(request.body);
        const id = await portfolioService.createTransaction(user.id, {
            symbol: body.symbol.toUpperCase(),
            side: body.side,
            quantity: body.quantity,
            price: body.price,
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
        const body = transactionUpdateBodySchema.parse(request.body);
        const params = transactionParamsSchema.parse(request.params);
        await portfolioService.updateTransaction(user.id, params.id, {
            quantity: body.quantity,
            price: body.price,
            tradedAt: body.tradedAt,
        });
        return { ok: true };
    });
    app.delete('/api/portfolio/transactions/:id', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        const params = transactionParamsSchema.parse(request.params);
        await portfolioService.deleteTransaction(user.id, params.id);
        return { ok: true };
    });
};
