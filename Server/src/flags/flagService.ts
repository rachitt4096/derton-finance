import crypto from 'node:crypto'
import type { Pool } from 'pg'

export class FlagService {
  constructor(private readonly pool: Pool) {}

  async listFlags() {
    const result = await this.pool.query<{
      id: string
      symbol: string
      company_name: string
      type: string
      detail: string
      since_label: string
      severity: string
      status: string
    }>(
      `
        select id, symbol, company_name, type, detail, since_label, severity, status
        from risk_flags
        order by created_at desc, symbol asc
      `,
    )

    return result.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      company: row.company_name,
      type: row.type,
      detail: row.detail,
      since: row.since_label,
      severity: row.severity,
      status: row.status,
    }))
  }

  async createFlag(input: {
    symbol: string
    company: string
    type: string
    detail: string
    since: string
    severity: string
    status: string
  }) {
    const id = crypto.randomUUID()
    await this.pool.query(
      `
        insert into risk_flags (id, symbol, company_name, type, detail, since_label, severity, status)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [id, input.symbol, input.company, input.type, input.detail, input.since, input.severity, input.status],
    )
    return id
  }

  async updateFlag(id: string, input: { detail: string; severity: string; status: string }) {
    await this.pool.query(
      `
        update risk_flags
        set detail = $2, severity = $3, status = $4
        where id = $1
      `,
      [id, input.detail, input.severity, input.status],
    )
  }

  async deleteFlag(id: string) {
    await this.pool.query('delete from risk_flags where id = $1', [id])
  }
}
