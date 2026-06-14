import { Pool } from 'pg';
export const createDbPool = (config) => new Pool({
    connectionString: config.POSTGRES_URL,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    max: 20,
});
