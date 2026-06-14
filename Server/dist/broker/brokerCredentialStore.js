const normalizeMetadata = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export class BrokerCredentialStore {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async get(provider) {
        const result = await this.pool.query(`
        select provider, access_token, expires_at::text, metadata, updated_at::text
        from broker_credentials
        where provider = $1
        limit 1
      `, [provider]);
        const row = result.rows[0];
        if (!row) {
            return null;
        }
        return {
            provider: row.provider,
            accessToken: row.access_token,
            expiresAt: row.expires_at ? new Date(row.expires_at) : null,
            metadata: normalizeMetadata(row.metadata),
            updatedAt: new Date(row.updated_at),
        };
    }
    async set(provider, accessToken, expiresAt, metadata = {}) {
        await this.pool.query(`
        insert into broker_credentials (provider, access_token, expires_at, metadata, updated_at)
        values ($1, $2, $3, $4::jsonb, now())
        on conflict (provider)
        do update set
          access_token = excluded.access_token,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          updated_at = now()
      `, [provider, accessToken, expiresAt?.toISOString() ?? null, JSON.stringify(metadata)]);
    }
    async clear(provider) {
        await this.pool.query('delete from broker_credentials where provider = $1', [provider]);
    }
    async resolveAccessToken(provider, envToken = '') {
        const stored = await this.get(provider);
        if (stored?.accessToken) {
            return stored.accessToken;
        }
        return envToken.trim() || null;
    }
}
