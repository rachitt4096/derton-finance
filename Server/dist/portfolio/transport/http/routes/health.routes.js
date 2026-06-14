export const registerHealthRoutes = (app, pool, marketRuntime) => {
    app.get('/api/health', async () => {
        const dbCheck = await pool.query('select 1 as ok');
        return {
            ok: true,
            db: dbCheck.rows[0]?.ok === 1 ? 'up' : 'down',
            broker: marketRuntime.getStatus(),
            timestamp: new Date().toISOString(),
        };
    });
};
