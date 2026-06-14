import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { AppConfig } from '../app/config.js'

const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

const ADMIN_USER_SEED = { username: 'ADMIN01', email: 'admin@derton.local', password: 'admin@2026', role: 'admin' } as const

export const seedDatabase = async (pool: Pool, config: AppConfig) => {
  const userSeeds = [
    {
      ...ADMIN_USER_SEED,
      username: config.SEED_ADMIN_USERNAME,
      email: config.SEED_ADMIN_EMAIL,
      password: config.SEED_ADMIN_PASSWORD,
    },
  ]

  for (const user of userSeeds) {
    const existing = await pool.query('select id from users where username = $1', [user.username])
    if (existing.rowCount) {
      continue
    }

    const passwordHash = await bcrypt.hash(user.password, 10)
    await pool.query(
      `
        insert into users (id, email, username, password_hash, role)
        values ($1, $2, $3, $4, $5)
      `,
      [makeId('usr'), user.email.toLowerCase(), user.username, passwordHash, user.role],
    )
  }

  const users = await pool.query<{ id: string }>('select id from users')
  for (const user of users.rows) {
    await pool.query<{ id: string }>(
      `
        insert into watchlists (id, user_id, name, is_default)
        values ($1, $2, 'Default', true)
        on conflict (user_id, name)
        do update set is_default = true
      `,
      [makeId('wl'), user.id],
    )
  }
}
