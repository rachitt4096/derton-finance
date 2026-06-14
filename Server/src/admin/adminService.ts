import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { UserRole } from '../lib/contracts.js'

type CreateUserInput = {
  username: string
  password: string
  role: UserRole
  displayName?: string
}

type UpdateUserInput = {
  email?: string
  role?: UserRole
  displayName?: string | null
  isActive?: boolean
}

type DbUserRow = {
  id: string
  email: string
  username: string
  display_name: string | null
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export class AdminServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'AdminServiceError'
  }
}

export class AdminService {
  constructor(private readonly pool: Pool) {}

  private buildManagedUserEmail(username: string) {
    return `${username.trim().toLowerCase()}@derton.local`
  }

  async getOverview() {
    const [users, sessions, instruments, ticks, watchlists] = await Promise.all([
      this.pool.query<{
        total_users: string
        active_users: string
        admin_users: string
      }>(
        `
          select
            count(*)::text as total_users,
            count(*) filter (where is_active = true)::text as active_users,
            count(*) filter (where role = 'admin' and is_active = true)::text as admin_users
          from users
        `,
      ),
      this.pool.query<{ active_sessions: string }>('select count(*)::text as active_sessions from sessions where expires_at > now()'),
      this.pool.query<{ instrument_count: string }>('select count(*)::text as instrument_count from instruments'),
      this.pool.query<{
        tick_count: string
        oldest_tick_at: string | null
        newest_tick_at: string | null
      }>(
        `
          select
            count(*)::text as tick_count,
            min(recorded_at)::text as oldest_tick_at,
            max(recorded_at)::text as newest_tick_at
          from market_ticks
        `,
      ),
      this.pool.query<{ watchlist_count: string }>('select count(*)::text as watchlist_count from watchlists'),
    ])

    const userRow = users.rows[0]
    const sessionRow = sessions.rows[0]
    const instrumentRow = instruments.rows[0]
    const tickRow = ticks.rows[0]
    const watchlistRow = watchlists.rows[0]

    return {
      users: {
        total: Number(userRow?.total_users ?? 0),
        active: Number(userRow?.active_users ?? 0),
        admins: Number(userRow?.admin_users ?? 0),
      },
      sessions: {
        active: Number(sessionRow?.active_sessions ?? 0),
      },
      instruments: {
        total: Number(instrumentRow?.instrument_count ?? 0),
      },
      watchlists: {
        total: Number(watchlistRow?.watchlist_count ?? 0),
      },
      marketHistory: {
        tickCount: Number(tickRow?.tick_count ?? 0),
        oldestTickAt: tickRow?.oldest_tick_at ?? null,
        newestTickAt: tickRow?.newest_tick_at ?? null,
      },
    }
  }

  async listUsers() {
    const result = await this.pool.query<
      DbUserRow & {
        active_session_count: string
        last_session_at: string | null
      }
    >(
      `
        select
          users.id,
          users.email,
          users.username,
          users.display_name,
          users.role,
          users.is_active,
          users.created_at::text,
          users.updated_at::text,
          count(sessions.id) filter (where sessions.expires_at > now())::text as active_session_count,
          max(sessions.created_at)::text as last_session_at
        from users
        left join sessions on sessions.user_id = users.id
        group by users.id
        order by users.created_at asc
      `,
    )

    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeSessionCount: Number(row.active_session_count ?? 0),
      lastSessionAt: row.last_session_at,
    }))
  }

  async createUser(actorUserId: string, input: CreateUserInput) {
    const username = input.username.trim().toUpperCase()
    const email = this.buildManagedUserEmail(username)
    const displayName = input.displayName?.trim() || null

    const existing = await this.pool.query(
      `
        select 1
        from users
        where lower(email) = lower($1) or upper(username) = upper($2)
        limit 1
      `,
      [email, username],
    )

    if (existing.rowCount) {
      throw new AdminServiceError('A user with this user ID already exists.', 409)
    }

    const id = crypto.randomUUID()
    const passwordHash = await bcrypt.hash(input.password, 10)

    await this.pool.query(
      `
        insert into users (id, email, username, display_name, password_hash, role, is_active, updated_at)
        values ($1, $2, $3, $4, $5, $6, true, now())
      `,
      [id, email, username, displayName, passwordHash, input.role],
    )

    await this.writeAudit(actorUserId, 'user.create', 'user', id, {
      email,
      username,
      role: input.role,
      displayName,
    })

    return id
  }

  async updateUser(actorUserId: string, userId: string, input: UpdateUserInput) {
    const user = await this.getUserRow(userId)
    if (!user) {
      throw new AdminServiceError('User not found.', 404)
    }

    const nextRole = input.role ?? user.role
    const nextIsActive = input.isActive ?? user.is_active

    if ((user.role === 'admin' && nextRole !== 'admin') || (user.role === 'admin' && nextIsActive === false)) {
      await this.ensureAnotherActiveAdminExists(user.id)
    }

    if (input.email) {
      const emailConflict = await this.pool.query(
        `
          select 1
          from users
          where lower(email) = lower($1) and id <> $2
          limit 1
        `,
        [input.email.trim().toLowerCase(), userId],
      )

      if (emailConflict.rowCount) {
        throw new AdminServiceError('Another user already uses this email.', 409)
      }
    }

    const updates: string[] = []
    const values: Array<string | boolean | null> = []
    let index = 1

    if (input.email !== undefined) {
      updates.push(`email = $${index++}`)
      values.push(input.email.trim().toLowerCase())
    }

    if (input.role !== undefined) {
      updates.push(`role = $${index++}`)
      values.push(input.role)
    }

    if (input.displayName !== undefined) {
      updates.push(`display_name = $${index++}`)
      values.push(input.displayName ? input.displayName.trim() : null)
    }

    if (input.isActive !== undefined) {
      updates.push(`is_active = $${index++}`)
      values.push(input.isActive)
    }

    updates.push(`updated_at = now()`)
    values.push(userId)

    await this.pool.query(
      `
        update users
        set ${updates.join(', ')}
        where id = $${index}
      `,
      values,
    )

    if (input.isActive === false) {
      await this.pool.query('delete from sessions where user_id = $1', [userId])
    }

    await this.writeAudit(actorUserId, 'user.update', 'user', userId, input)
  }

  async resetPassword(actorUserId: string, userId: string, password: string) {
    const user = await this.getUserRow(userId)
    if (!user) {
      throw new AdminServiceError('User not found.', 404)
    }

    const passwordHash = await bcrypt.hash(password, 10)
    await this.pool.query(
      `
        update users
        set password_hash = $2, updated_at = now()
        where id = $1
      `,
      [userId, passwordHash],
    )

    await this.pool.query('delete from sessions where user_id = $1', [userId])

    await this.writeAudit(actorUserId, 'user.reset_password', 'user', userId, {
      revokeSessions: true,
    })
  }

  async revokeSessions(actorUserId: string, userId: string) {
    const user = await this.getUserRow(userId)
    if (!user) {
      throw new AdminServiceError('User not found.', 404)
    }

    await this.pool.query('delete from sessions where user_id = $1', [userId])

    await this.writeAudit(actorUserId, 'user.revoke_sessions', 'user', userId, {})
  }

  private async getUserRow(userId: string) {
    const result = await this.pool.query<DbUserRow>(
      `
        select id, email, username, display_name, role, is_active, created_at::text, updated_at::text
        from users
        where id = $1
        limit 1
      `,
      [userId],
    )

    return result.rows[0] ?? null
  }

  private async ensureAnotherActiveAdminExists(excludedUserId: string) {
    const result = await this.pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from users
        where role = 'admin'
          and is_active = true
          and id <> $1
      `,
      [excludedUserId],
    )

    if (Number(result.rows[0]?.count ?? 0) < 1) {
      throw new AdminServiceError('You cannot remove or deactivate the last active admin.', 409)
    }
  }

  private async writeAudit(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string | null,
    payload: Record<string, unknown>,
  ) {
    await this.pool.query(
      `
        insert into audit_logs (id, actor_user_id, action, entity_type, entity_id, payload)
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [crypto.randomUUID(), actorUserId, action, entityType, entityId, JSON.stringify(payload)],
    )
  }
}
