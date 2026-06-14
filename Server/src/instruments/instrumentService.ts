import { gunzipSync } from 'node:zlib'
import type { Pool } from 'pg'
import type { InstrumentRecord } from '../lib/contracts.js'
import { COMPANY_REFERENCE_DATA } from './companyReferenceData.js'

type UpstoxInstrumentRow = {
  trading_symbol?: string
  symbol?: string
  name?: string
  exchange?: string
  segment?: string
  instrument_type?: string
  instrument_key?: string
  instrumentKey?: string
}

const isInstrumentKeyConflict = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === '23505' &&
  'constraint' in error &&
  error.constraint === 'instruments_instrument_key_key'

export class InstrumentService {
  constructor(private readonly pool: Pool) {}

  async syncFromUpstox(instrumentsUrl: string) {
    if (!instrumentsUrl) {
      return 0
    }

    const response = await fetch(instrumentsUrl)
    if (!response.ok) {
      throw new Error(`Instrument sync failed with HTTP ${response.status}`)
    }

    const payload = await this.parseUpstoxPayload(response, instrumentsUrl)
    const seenSymbols = new Set<string>()
    const seenInstrumentKeys = new Set<string>()
    let count = 0

    for (const item of payload) {
      const symbol = (item.trading_symbol ?? item.symbol ?? '').trim().toUpperCase()
      const companyName = (item.name ?? symbol).trim()
      const exchange = (item.exchange ?? 'NSE').trim().toUpperCase()
      const segment = (item.segment ?? '').trim().toUpperCase()
      const instrumentType = (item.instrument_type ?? '').trim().toUpperCase()
      const instrumentKey = (item.instrument_key ?? item.instrumentKey ?? '').trim()

      if (!symbol || !instrumentKey) {
        continue
      }

      if (segment && segment !== 'NSE_EQ') {
        continue
      }

      if (instrumentType && !['EQ', 'BE'].includes(instrumentType)) {
        continue
      }

      // Upstox can return duplicate equity rows; skip duplicates so startup stays idempotent.
      if (seenSymbols.has(symbol) || seenInstrumentKeys.has(instrumentKey)) {
        continue
      }

      seenSymbols.add(symbol)
      seenInstrumentKeys.add(instrumentKey)
      const referenceProfile = COMPANY_REFERENCE_DATA[symbol]
      const metadata = referenceProfile ? JSON.stringify({ companyOverview: referenceProfile }) : '{}'

      try {
        await this.pool.query(
          `
            insert into instruments (symbol, company_name, exchange, instrument_key, metadata, updated_at)
            values ($1, $2, $3, $4, $5::jsonb, now())
            on conflict (symbol)
            do update set
              company_name = excluded.company_name,
              exchange = excluded.exchange,
              instrument_key = excluded.instrument_key,
              metadata = case
                when excluded.metadata = '{}'::jsonb then instruments.metadata
                else coalesce(instruments.metadata, '{}'::jsonb) || excluded.metadata
              end,
              updated_at = now()
          `,
          [symbol, companyName, exchange, instrumentKey, metadata],
        )
        count += 1
      } catch (error) {
        if (isInstrumentKeyConflict(error)) {
          continue
        }

        throw error
      }
    }

    return count
  }

  async search(query: string, limit = 20): Promise<InstrumentRecord[]> {
    const trimmed = query.trim()
    if (!trimmed) {
      return []
    }

    const result = await this.pool.query<{
      symbol: string
      company_name: string
      exchange: string
      instrument_key: string
    }>(
      `
        select symbol, company_name, exchange, instrument_key
        from instruments
        where symbol ilike $1 or company_name ilike $1
        order by
          case when symbol ilike $2 then 0 else 1 end,
          symbol asc
        limit $3
      `,
      [`%${trimmed}%`, `${trimmed}%`, limit],
    )

    return result.rows.map((row) => ({
      symbol: row.symbol,
      companyName: row.company_name,
      exchange: row.exchange,
      instrumentKey: row.instrument_key,
    }))
  }

  async listSymbols() {
    const result = await this.pool.query<{ symbol: string }>('select symbol from instruments order by symbol asc')
    return result.rows.map((row) => row.symbol)
  }

  async getBySymbols(symbols: string[]) {
    if (!symbols.length) {
      return []
    }

    const result = await this.pool.query<{
      symbol: string
      company_name: string
      exchange: string
      instrument_key: string
    }>(
      `
        select symbol, company_name, exchange, instrument_key
        from instruments
        where symbol = any($1::text[])
      `,
      [symbols],
    )

    return result.rows.map((row) => ({
      symbol: row.symbol,
      companyName: row.company_name,
      exchange: row.exchange,
      instrumentKey: row.instrument_key,
    }))
  }
  private async parseUpstoxPayload(response: Response, instrumentsUrl: string) {
    const contentType = response.headers.get('content-type') ?? ''
    const shouldGunzip = instrumentsUrl.endsWith('.gz') || /gzip/i.test(contentType)

    if (!shouldGunzip) {
      return (await response.json()) as UpstoxInstrumentRow[]
    }

    const compressed = Buffer.from(await response.arrayBuffer())
    return JSON.parse(gunzipSync(compressed).toString('utf8')) as UpstoxInstrumentRow[]
  }
}
