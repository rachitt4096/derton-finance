import { createDbPool } from '../db/index.js'
import { ensureSchema } from '../db/schema.js'
import { InstrumentService } from '../instruments/instrumentService.js'
import type { CandlePoint } from '../lib/contracts.js'
import { UpstoxHistoryService, type HistoryInterval } from '../market/upstoxHistoryService.js'
import { BrokerCredentialStore } from '../broker/brokerCredentialStore.js'
import { loadConfig } from '../app/config.js'
import { buildHistoryChunks, compareDate, formatDate } from '../market/historyBackfill.js'

type CliOptions = {
  symbols: string[]
  interval: HistoryInterval
  fromDate: string
  toDate: string
}

const VALID_INTERVALS: HistoryInterval[] = ['1m', '5m', '15m', '1h', '1d']

const usage = `
Usage:
  npm run backfill:candles -- --symbols=RELIANCE,TCS --from=2026-01-01 --to=2026-01-31 [--interval=1m]

Options:
  --symbols   Comma-separated symbol list. Required.
  --from      Start date in YYYY-MM-DD. Defaults to 30 days before today.
  --to        End date in YYYY-MM-DD. Defaults to today.
  --interval  One of 1m, 5m, 15m, 1h, 1d. Defaults to 1m.
`.trim()

const parseArgValue = (name: string) => {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))
  return match ? match.slice(name.length + 3).trim() : ''
}

const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`)

const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())

const getDefaultFromDate = () => {
  const today = new Date()
  return formatDate(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))
}

const parseOptions = (): CliOptions => {
  if (hasFlag('help')) {
    console.log(usage)
    process.exit(0)
  }

  const symbols = parseArgValue('symbols')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)

  if (!symbols.length) {
    throw new Error('Missing required --symbols option.\n\n' + usage)
  }

  const interval = (parseArgValue('interval') || '1m') as HistoryInterval
  if (!VALID_INTERVALS.includes(interval)) {
    throw new Error(`Invalid --interval value "${interval}". Expected one of: ${VALID_INTERVALS.join(', ')}`)
  }

  const toDate = parseArgValue('to') || formatDate(new Date())
  const fromDate = parseArgValue('from') || getDefaultFromDate()

  if (!isValidDate(fromDate) || !isValidDate(toDate)) {
    throw new Error('Both --from and --to must be valid YYYY-MM-DD dates.')
  }

  if (compareDate(fromDate, toDate) > 0) {
    throw new Error('--from must be earlier than or equal to --to.')
  }

  return {
    symbols,
    interval,
    fromDate,
    toDate,
  }
}

const normalizeHistoricalCandles = (
  symbol: string,
  interval: HistoryInterval,
  candles: CandlePoint[],
) =>
  candles
    .map((candle) => {
      const bucketStartMs = new Date(candle.time).getTime()
      if (!Number.isFinite(bucketStartMs)) {
        return null
      }

      const intervalMs =
        interval === '1m'
          ? 60_000
          : interval === '5m'
            ? 5 * 60_000
            : interval === '15m'
              ? 15 * 60_000
              : interval === '1h'
                ? 60 * 60_000
                : 24 * 60 * 60_000

      return {
        symbol,
        interval,
        bucketStart: new Date(bucketStartMs).toISOString(),
        firstTradeAt: new Date(bucketStartMs).toISOString(),
        lastTradeAt: new Date(bucketStartMs + intervalMs - 1).toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: Number(candle.volume ?? 0),
        source: 'provider' as const,
      }
    })
    .filter(
      (
        candle,
      ): candle is {
        symbol: string
        interval: HistoryInterval
        bucketStart: string
        firstTradeAt: string
        lastTradeAt: string
        open: number
        high: number
        low: number
        close: number
        volume: number
        source: 'provider'
      } => Boolean(candle),
    )

const replaceCandles = async (connectionString: { query: (sql: string, values: Array<string | number>) => Promise<unknown> }, rows: ReturnType<typeof normalizeHistoricalCandles>) => {
  if (!rows.length) {
    return
  }

  const values: Array<string | number> = []
  const sqlRows = rows
    .map((row, index) => {
      const base = index * 11
      values.push(
        row.symbol,
        row.interval,
        row.bucketStart,
        row.firstTradeAt,
        row.lastTradeAt,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.source,
      )

      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, now(), now())`
    })
    .join(', ')

  await connectionString.query(
    `
      insert into market_candles (
        symbol,
        interval,
        bucket_start,
        first_trade_at,
        last_trade_at,
        open,
        high,
        low,
        close,
        volume,
        source,
        created_at,
        updated_at
      )
      values ${sqlRows}
      on conflict (symbol, interval, bucket_start) do update
      set first_trade_at = case
            when market_candles.source = 'broker' then market_candles.first_trade_at
            else excluded.first_trade_at
          end,
          last_trade_at = case
            when market_candles.source = 'broker' then market_candles.last_trade_at
            else excluded.last_trade_at
          end,
          open = case
            when market_candles.source = 'broker' then market_candles.open
            else excluded.open
          end,
          high = case
            when market_candles.source = 'broker' then market_candles.high
            else excluded.high
          end,
          low = case
            when market_candles.source = 'broker' then market_candles.low
            else excluded.low
          end,
          close = case
            when market_candles.source = 'broker' then market_candles.close
            else excluded.close
          end,
          volume = case
            when market_candles.source = 'broker' then market_candles.volume
            else excluded.volume
          end,
          source = case
            when market_candles.source = 'broker' then market_candles.source
            else excluded.source
          end,
          updated_at = now()
    `,
    values,
  )
}

const main = async () => {
  const options = parseOptions()
  const config = loadConfig()
  const pool = createDbPool(config)

  try {
    await ensureSchema(pool)

    const instrumentService = new InstrumentService(pool)
    const credentialStore = new BrokerCredentialStore(pool)
    const historyService = new UpstoxHistoryService(config, instrumentService, credentialStore)

    const existing = await instrumentService.getBySymbols(options.symbols)
    const missingSymbols = options.symbols.filter((symbol) => !existing.some((instrument) => instrument.symbol === symbol))

    if (missingSymbols.length && config.UPSTOX_INSTRUMENTS_URL) {
      const synced = await instrumentService.syncFromUpstox(config.UPSTOX_INSTRUMENTS_URL)
      console.log(`Instrument master synced before backfill. Rows updated: ${synced}`)
    }

    const resolved = await instrumentService.getBySymbols(options.symbols)
    const unresolved = options.symbols.filter((symbol) => !resolved.some((instrument) => instrument.symbol === symbol))
    if (unresolved.length) {
      throw new Error(`Unknown symbols: ${unresolved.join(', ')}`)
    }

    const chunks = buildHistoryChunks(options.fromDate, options.toDate, options.interval)
    console.log(
      `Starting candle backfill for ${options.symbols.join(', ')} from ${options.fromDate} to ${options.toDate} at ${options.interval} in ${chunks.length} chunk(s).`,
    )

    for (const symbol of options.symbols) {
      let totalCandles = 0

      for (const chunk of chunks) {
        const candles = await historyService.getCandlesBySymbolRange(symbol, options.interval, chunk.fromDate, chunk.toDate)
        const normalized = normalizeHistoricalCandles(symbol, options.interval, candles)
        await replaceCandles(pool, normalized)
        totalCandles += normalized.length
        console.log(
          `[${symbol}] ${chunk.fromDate} -> ${chunk.toDate}: fetched ${candles.length} candle(s), stored ${normalized.length}.`,
        )
      }

      console.log(`[${symbol}] backfill complete. Stored ${totalCandles} candle(s).`)
    }
  } finally {
    await pool.end()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
