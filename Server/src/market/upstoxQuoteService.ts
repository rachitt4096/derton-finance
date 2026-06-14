import { ApiClient, MarketQuoteApi } from 'upstox-js-sdk'
import type { AppConfig } from '../app/config.js'
import type { BrokerCredentialStore } from '../broker/brokerCredentialStore.js'
import type { InstrumentService } from '../instruments/instrumentService.js'
import type { UpstoxHistoryService } from './upstoxHistoryService.js'
import type { LiveMarketQuote, MarketDepthLevel } from '../lib/contracts.js'
import { isNseTradingSessionOpen } from './session.js'

type RawDepthRow = {
  quantity?: number
  price?: number
  orders?: number
}

type RawQuote = {
  ltpc?: {
    ltp?: number
    cp?: number
  }
  ohlc?: {
    open?: number
    high?: number
    low?: number
    close?: number
  }
  depth?: {
    buy?: RawDepthRow[]
    sell?: RawDepthRow[]
  }
  instrument_token?: string
  instrumentToken?: string
  symbol?: string
  last_price?: number
  lastPrice?: number
  volume?: number
  average_price?: number
  averagePrice?: number
  net_change?: number
  netChange?: number
  total_buy_quantity?: number
  totalBuyQuantity?: number
  total_sell_quantity?: number
  totalSellQuantity?: number
  lower_circuit_limit?: number
  lowerCircuitLimit?: number
  upper_circuit_limit?: number
  upperCircuitLimit?: number
  last_trade_time?: string | number
  lastTradeTime?: string | number
  timestamp?: string
}

type FullMarketQuoteResponse = {
  status?: string
  data?: Record<string, RawQuote>
}

const toNumber = (value: unknown) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const pickNumber = (...values: unknown[]) => {
  for (const value of values) {
    const next = toNumber(value)
    if (next !== null) {
      return next
    }
  }

  return null
}

const normalizeDepth = (rows: RawDepthRow[] | undefined): MarketDepthLevel[] =>
  (rows ?? []).map((row) => ({
    quantity: toNumber(row.quantity) ?? 0,
    price: toNumber(row.price) ?? 0,
    orders: toNumber(row.orders) ?? 0,
  }))

const callSdk = <T>(runner: (callback: (error: unknown, data: T) => void) => void) =>
  new Promise<T>((resolve, reject) => {
    runner((error, data) => {
      if (error) {
        reject(error)
        return
      }

      resolve(data)
    })
  })

export class UpstoxQuoteService {
  constructor(
    private readonly config: AppConfig,
    private readonly instrumentService: InstrumentService,
    private readonly credentialStore: BrokerCredentialStore,
    private readonly historyService: UpstoxHistoryService,
  ) {}

  async getQuotes(symbols: string[]): Promise<LiveMarketQuote[]> {
    const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
    if (!normalizedSymbols.length) {
      return []
    }

    const accessToken = await this.credentialStore.resolveAccessToken('upstox', this.config.UPSTOX_ACCESS_TOKEN)
    if (!accessToken) {
      throw new Error('Upstox access token is not configured')
    }

    const instruments = await this.instrumentService.getBySymbols(normalizedSymbols)
    if (!instruments.length) {
      return []
    }

    const apiClient = ApiClient.instance
    const oauth = apiClient.authentications?.OAUTH2
    if (!oauth) {
      throw new Error('Upstox SDK OAuth client is unavailable')
    }
    oauth.accessToken = accessToken

    const quoteApi = new MarketQuoteApi(apiClient)
    const instrumentKeys = instruments.map((item) => item.instrumentKey).join(',')
    const response = await callSdk<FullMarketQuoteResponse>((callback) => {
      quoteApi.getFullMarketQuote(instrumentKeys, '2.0', (error: unknown, data: unknown) =>
        callback(error, data as FullMarketQuoteResponse),
      )
    })

    const rawData = response?.data ?? {}
    const shouldBackfillClosedSessionLtp = !isNseTradingSessionOpen()

    const minuteCloseBySymbol = new Map<string, number | null>()
    if (shouldBackfillClosedSessionLtp) {
      const minuteCloses = await Promise.all(
        instruments.map(async (instrument) => {
          try {
            return [instrument.symbol, await this.historyService.getLatestMinuteClose(instrument.symbol, 7)] as const
          } catch {
            return [instrument.symbol, null] as const
          }
        }),
      )

      minuteCloses.forEach(([symbol, value]) => {
        minuteCloseBySymbol.set(symbol, value)
      })
    }

    const yearRanges = await Promise.all(
      instruments.map(async (instrument) => {
        try {
          return await this.historyService.get52WeekRange(instrument.symbol)
        } catch {
          return {
            yearHigh: null,
            yearLow: null,
            yearHighDate: null,
            yearLowDate: null,
          }
        }
      }),
    )

    return instruments.map((instrument, index) => {
      const raw =
        Object.values(rawData).find(
          (item) =>
            item?.instrument_token === instrument.instrumentKey ||
            item?.instrumentToken === instrument.instrumentKey ||
            item?.symbol?.toUpperCase() === instrument.symbol ||
            false,
        ) ?? null

      const apiLastPrice = pickNumber(raw?.last_price, raw?.lastPrice, raw?.ltpc?.ltp)
      const minuteClose = minuteCloseBySymbol.get(instrument.symbol) ?? null
      const lastPrice = minuteClose ?? apiLastPrice
      const rawNetChange = pickNumber(raw?.net_change, raw?.netChange)
      const previousClose = pickNumber(
        raw?.ltpc?.cp,
        apiLastPrice !== null && rawNetChange !== null ? apiLastPrice - rawNetChange : null,
        raw?.ohlc?.close,
      )
      const netChange = lastPrice !== null && previousClose !== null ? lastPrice - previousClose : rawNetChange
      const sessionClose = pickNumber(raw?.ohlc?.close, apiLastPrice)
      const yearRange = yearRanges[index]

      return {
        symbol: instrument.symbol,
        companyName: instrument.companyName,
        exchange: instrument.exchange,
        instrumentKey: instrument.instrumentKey,
        lastPrice,
        sessionClose,
        open: toNumber(raw?.ohlc?.open),
        high: toNumber(raw?.ohlc?.high),
        low: toNumber(raw?.ohlc?.low),
        close: previousClose,
        volume: toNumber(raw?.volume),
        averagePrice: pickNumber(raw?.average_price, raw?.averagePrice),
        netChange,
        percentChange: previousClose !== null && previousClose !== 0 && netChange !== null ? (netChange / previousClose) * 100 : null,
        lowerCircuitLimit: pickNumber(raw?.lower_circuit_limit, raw?.lowerCircuitLimit),
        upperCircuitLimit: pickNumber(raw?.upper_circuit_limit, raw?.upperCircuitLimit),
        totalBuyQuantity: pickNumber(raw?.total_buy_quantity, raw?.totalBuyQuantity),
        totalSellQuantity: pickNumber(raw?.total_sell_quantity, raw?.totalSellQuantity),
        lastTradeTime: raw?.last_trade_time
          ? String(raw.last_trade_time)
          : raw?.lastTradeTime
            ? String(raw.lastTradeTime)
            : null,
        timestamp: raw?.timestamp ?? null,
        yearHigh: yearRange.yearHigh,
        yearLow: yearRange.yearLow,
        yearHighDate: yearRange.yearHighDate,
        yearLowDate: yearRange.yearLowDate,
        depth: {
          buy: normalizeDepth(raw?.depth?.buy),
          sell: normalizeDepth(raw?.depth?.sell),
        },
      }
    })
  }
}
