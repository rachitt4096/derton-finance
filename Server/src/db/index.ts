import { Pool } from 'pg'
import type { AppConfig } from '../app/config.js'

export const createDbPool = (config: AppConfig) =>
  new Pool({
    connectionString: config.POSTGRES_URL,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    max: 20,
  })
