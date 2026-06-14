import crypto from 'node:crypto'
import type { Pool } from 'pg'

export class WatchlistService {
  constructor(private readonly pool: Pool) {}

  async getAllDefaultWatchlistSymbols() {
    const result = await this.pool.query<{ symbol: string }>(
      `
        select distinct watchlist_items.symbol
        from watchlists
        join watchlist_items on watchlist_items.watchlist_id = watchlists.id
        where watchlists.is_default = true
        order by watchlist_items.symbol asc
      `,
    )

    return result.rows.map((row) => row.symbol)
  }

  async getDefaultWatchlist(userId: string) {
    const result = await this.pool.query<{ symbol: string }>(
      `
        select watchlist_items.symbol
        from watchlists
        join watchlist_items on watchlist_items.watchlist_id = watchlists.id
        where watchlists.user_id = $1
          and watchlists.is_default = true
        order by watchlist_items.sort_order asc
      `,
      [userId],
    )

    return result.rows.map((row) => row.symbol)
  }

  async setDefaultWatchlist(userId: string, symbols: string[]) {
    const normalized = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
    const instrumentRows = await this.pool.query<{ symbol: string }>(
      'select symbol from instruments where symbol = any($1::text[])',
      [normalized],
    )

    const validSymbols = new Set(instrumentRows.rows.map((row) => row.symbol))
    const filtered = normalized.filter((symbol) => validSymbols.has(symbol))

    const existing = await this.pool.query<{ id: string }>(
      `
        select id from watchlists
        where user_id = $1 and is_default = true
        limit 1
      `,
      [userId],
    )

    const watchlistId = existing.rows[0]?.id ?? crypto.randomUUID()
    await this.pool.query(
      `
        insert into watchlists (id, user_id, name, is_default)
        values ($1, $2, 'Default', true)
        on conflict (user_id, name)
        do update set is_default = true
      `,
      [watchlistId, userId],
    )

    await this.pool.query('delete from watchlist_items where watchlist_id = $1', [watchlistId])

    for (const [index, symbol] of filtered.entries()) {
      await this.pool.query(
        `
          insert into watchlist_items (id, watchlist_id, symbol, sort_order)
          values ($1, $2, $3, $4)
        `,
        [crypto.randomUUID(), watchlistId, symbol, index],
      )
    }

    return filtered
  }
}
