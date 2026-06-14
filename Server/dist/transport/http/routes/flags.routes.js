import { z } from 'zod';
import { requireSessionUser } from '../../../lib/httpAuth.js';
const flagParamsSchema = z.object({
    id: z.string().min(1),
});
const createFlagBodySchema = z.object({
    symbol: z.string().trim().min(1),
    company: z.string().trim().min(1),
    type: z.string().trim().min(1),
    detail: z.string().trim().min(1),
    since: z.string().trim().min(1),
    severity: z.string().trim().min(1),
    status: z.string().trim().min(1),
});
const updateFlagBodySchema = z.object({
    detail: z.string().trim().min(1),
    severity: z.string().trim().min(1),
    status: z.string().trim().min(1),
});
export const registerFlagRoutes = (app, authService, flagService, config) => {
    app.get('/api/flags', async () => ({
        items: await flagService.listFlags(),
    }));
    app.post('/api/flags', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        if (user.role !== 'admin') {
            return reply.code(403).send({ error: 'Forbidden' });
        }
        const body = createFlagBodySchema.parse(request.body);
        const id = await flagService.createFlag(body);
        reply.code(201);
        return { id };
    });
    app.put('/api/flags/:id', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        if (user.role !== 'admin') {
            return reply.code(403).send({ error: 'Forbidden' });
        }
        const body = updateFlagBodySchema.parse(request.body);
        const params = flagParamsSchema.parse(request.params);
        await flagService.updateFlag(params.id, body);
        return { ok: true };
    });
    app.delete('/api/flags/:id', async (request, reply) => {
        const user = await requireSessionUser(request, reply, authService, config.COOKIE_NAME);
        if (!user) {
            return;
        }
        if (user.role !== 'admin') {
            return reply.code(403).send({ error: 'Forbidden' });
        }
        const params = flagParamsSchema.parse(request.params);
        await flagService.deleteFlag(params.id);
        return { ok: true };
    });
};
