import { z } from 'zod'

export const userRoleSchema = z.enum(['admin', 'analyst'])
export type UserRole = z.infer<typeof userRoleSchema>

export const feedStatusSchema = z.enum([
  'idle',
  'connecting',
  'live',
  'degraded',
  'offline',
])
export type FeedStatus = z.infer<typeof feedStatusSchema>

export const loginBodySchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
})

export const watchlistUpdateSchema = z.object({
  symbols: z.array(z.string().min(1)).max(100),
})

export const marketHistoryQuerySchema = z.object({
  symbol: z.string().min(1),
  days: z.coerce.number().int().positive().max(3650).default(30),
  interval: z.enum(['1m', '5m', '15m', '1h', '1d']).default('1m'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const companyInsightsQuerySchema = z.object({
  symbols: z.string().min(1),
  includeHistory: z
    .enum(['0', '1', 'false', 'true'])
    .optional()
    .default('0')
    .transform((value) => value === '1' || value === 'true'),
  historyDays: z.coerce.number().int().positive().max(3650).default(30),
})

export const adminCreateUserSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
  role: userRoleSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
})

export const adminUpdateUserSchema = z
  .object({
    email: z.string().email().optional(),
    role: userRoleSchema.optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one field must be provided',
  })

export const adminResetPasswordSchema = z.object({
  password: z.string().min(8).max(128),
})

export interface SessionUser {
  id: string
  email: string
  username: string
  role: UserRole
}

export interface InstrumentRecord {
  symbol: string
  companyName: string
  exchange: string
  instrumentKey: string
}

export interface MarketDepthLevel {
  quantity: number
  price: number
  orders: number
}

export interface LiveMarketQuote {
  symbol: string
  companyName: string | null
  exchange: string | null
  instrumentKey: string | null
  lastPrice: number | null
  sessionClose: number | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  averagePrice: number | null
  netChange: number | null
  percentChange: number | null
  lowerCircuitLimit: number | null
  upperCircuitLimit: number | null
  totalBuyQuantity: number | null
  totalSellQuantity: number | null
  lastTradeTime: string | null
  timestamp: string | null
  yearHigh: number | null
  yearLow: number | null
  yearHighDate: string | null
  yearLowDate: string | null
  depth: {
    buy: MarketDepthLevel[]
    sell: MarketDepthLevel[]
  }
}

export interface WatchlistRecord {
  id: string
  name: string
  symbols: string[]
}

export interface BrokerTick {
  symbol: string
  price: number
  recordedAt: number
  volume?: number | null
  quote?: Partial<LiveMarketQuote> | null
  payload?: Record<string, unknown> | null
}

export interface BrokerStatusSnapshot {
  source: 'upstox'
  status: FeedStatus
  lastTickAt: number | null
  retryInMs: number | null
  error: string | null
}

export interface MarketSnapshotPayload {
  type: 'market.snapshot'
  ts: number
  source: 'upstox'
  marketState: FeedStatus
  prices: Record<string, number>
  quotes: Record<string, LiveMarketQuote>
  snapshotAgeMs: number | null
  lastTickAt: number | null
}

export interface FeedStatusPayload {
  type: 'feed.status'
  source: 'upstox'
  status: FeedStatus
  lastTickAt: number | null
  retryInMs: number | null
  error: string | null
}

export interface SessionReadyPayload {
  type: 'session.ready'
  user: SessionUser
  watchlist: string[]
  feedStatus: BrokerStatusSnapshot
}

export interface ErrorPayload {
  type: 'error'
  message: string
}

export type ServerSocketMessage =
  | SessionReadyPayload
  | MarketSnapshotPayload
  | FeedStatusPayload
  | ErrorPayload

export const sessionInitMessageSchema = z.object({
  type: z.literal('session.init'),
})

export const watchlistSetMessageSchema = z.object({
  type: z.literal('watchlist.set'),
  symbols: z.array(z.string().min(1)).max(100),
})

export const focusSetMessageSchema = z.object({
  type: z.literal('focus.set'),
  symbol: z.string().min(1),
})

export const symbolsSetMessageSchema = z.object({
  type: z.literal('symbols.set'),
  symbols: z.array(z.string().min(1)).max(250),
})

export const clientSocketMessageSchema = z.union([
  sessionInitMessageSchema,
  watchlistSetMessageSchema,
  focusSetMessageSchema,
  symbolsSetMessageSchema,
])

export type ClientSocketMessage = z.infer<typeof clientSocketMessageSchema>

export interface CandlePoint {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}
