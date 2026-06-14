import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export class AuthService {
    pool;
    config;
    constructor(pool, config) {
        this.pool = pool;
        this.config = config;
    }
    async login(identifier, password) {
        const result = await this.pool.query(`
        select id, email, username, password_hash, role
        from users
        where (lower(email) = lower($1) or upper(username) = upper($1))
          and is_active = true
        limit 1
      `, [identifier.trim()]);
        const user = result.rows[0];
        if (!user) {
            return null;
        }
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return null;
        }
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 60 * 60 * 1000);
        await this.pool.query(`
        insert into sessions (id, user_id, token_hash, expires_at)
        values ($1, $2, $3, $4)
      `, [crypto.randomUUID(), user.id, tokenHash, expiresAt.toISOString()]);
        return {
            token: rawToken,
            expiresAt,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: user.role,
            },
        };
    }
    async logout(token) {
        await this.pool.query('delete from sessions where token_hash = $1', [hashToken(token)]);
    }
    async getSessionUser(token) {
        const result = await this.pool.query(`
        select users.id, users.email, users.username, users.role
        from sessions
        join users on users.id = sessions.user_id
        where sessions.token_hash = $1
          and sessions.expires_at > now()
          and users.is_active = true
        limit 1
      `, [hashToken(token)]);
        return result.rows[0] ?? null;
    }
    async revokeUserSessions(userId) {
        await this.pool.query('delete from sessions where user_id = $1', [userId]);
    }
}
