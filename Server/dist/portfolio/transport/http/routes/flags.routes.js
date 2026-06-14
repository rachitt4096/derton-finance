import { requireSessionUser } from '../../../lib/httpAuth.js';
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
        const body = request.body;
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
        const body = request.body;
        const params = request.params;
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
        const params = request.params;
        await flagService.deleteFlag(params.id);
        return { ok: true };
    });
};
