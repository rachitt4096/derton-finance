import { z } from 'zod';
const searchQuerySchema = z.object({
    q: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const registerInstrumentRoutes = (app, instrumentService) => {
    app.get('/api/instruments/search', async (request) => {
        const { q, limit } = searchQuerySchema.parse(request.query);
        return {
            items: await instrumentService.search(q, limit),
        };
    });
};
