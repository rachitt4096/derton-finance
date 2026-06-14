import { resolveDisplayPrice } from './marketPrice'

export const NIFTY_50_SYMBOLS = [
  'RELIANCE',
  'HDFCBANK',
  'ICICIBANK',
  'INFY',
  'TCS',
  'ITC',
  'LT',
  'SBIN',
  'BHARTIARTL',
  'AXISBANK',
  'KOTAKBANK',
  'M&M',
  'HINDUNILVR',
  'BAJFINANCE',
  'SUNPHARMA',
  'MARUTI',
  'TITAN',
  'ULTRACEMCO',
  'ASIANPAINT',
  'NTPC',
  'POWERGRID',
  'TATASTEEL',
  'ONGC',
  'WIPRO',
  'COALINDIA',
  'TECHM',
  'HCLTECH',
  'ADANIENT',
  'ADANIPORTS',
  'BAJAJFINSV',
  'NESTLEIND',
  'JSWSTEEL',
  'GRASIM',
  'HINDALCO',
  'CIPLA',
  'DRREDDY',
  'EICHERMOT',
  'HEROMOTOCO',
  'TATAMOTORS',
  'BRITANNIA',
  'INDUSINDBK',
  'APOLLOHOSP',
  'BPCL',
  'DIVISLAB',
  'BAJAJ-AUTO',
  'SHRIRAMFIN',
  'SBILIFE',
  'HDFCLIFE',
  'TATACONSUM',
  'UPL',
]

const sectorBySymbol = {
  RELIANCE: 'Energy',
  HDFCBANK: 'Financials',
  ICICIBANK: 'Financials',
  INFY: 'IT',
  TCS: 'IT',
  ITC: 'Consumer',
  LT: 'Industrials',
  SBIN: 'Financials',
  BHARTIARTL: 'Telecom',
  AXISBANK: 'Financials',
  KOTAKBANK: 'Financials',
  'M&M': 'Auto',
  HINDUNILVR: 'Consumer',
  BAJFINANCE: 'Financials',
  SUNPHARMA: 'Healthcare',
  MARUTI: 'Auto',
  TITAN: 'Consumer',
  ULTRACEMCO: 'Materials',
  ASIANPAINT: 'Materials',
  NTPC: 'Utilities',
  POWERGRID: 'Utilities',
  TATASTEEL: 'Materials',
  ONGC: 'Energy',
  WIPRO: 'IT',
  COALINDIA: 'Energy',
  TECHM: 'IT',
  HCLTECH: 'IT',
  ADANIENT: 'Diversified',
  ADANIPORTS: 'Industrials',
  BAJAJFINSV: 'Financials',
  NESTLEIND: 'Consumer',
  JSWSTEEL: 'Materials',
  GRASIM: 'Materials',
  HINDALCO: 'Materials',
  CIPLA: 'Healthcare',
  DRREDDY: 'Healthcare',
  EICHERMOT: 'Auto',
  HEROMOTOCO: 'Auto',
  TATAMOTORS: 'Auto',
  BRITANNIA: 'Consumer',
  INDUSINDBK: 'Financials',
  APOLLOHOSP: 'Healthcare',
  BPCL: 'Energy',
  DIVISLAB: 'Healthcare',
  'BAJAJ-AUTO': 'Auto',
  SHRIRAMFIN: 'Financials',
  SBILIFE: 'Financials',
  HDFCLIFE: 'Financials',
  TATACONSUM: 'Consumer',
  UPL: 'Materials',
}

const fallbackSeed = (symbol) => {
  let hash = 0
  for (const char of symbol) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973
  }
  return hash
}

export const buildMarketRows = ({ symbols = [], prices = {}, marketQuotes = {}, feed, now }) => {
  const universe = [...new Set([...NIFTY_50_SYMBOLS, ...(symbols ?? [])].filter(Boolean))]

  return universe.map((symbol, index) => {
    const quote = marketQuotes[symbol] ?? null
    const seed = fallbackSeed(symbol)
    const fallbackClose = 90 + ((seed * 17) % 22000)
    const fallbackPercent = ((seed % 1900) / 100 - 9.5) / 2.4
    const close = Number.isFinite(quote?.close) ? quote.close : fallbackClose
    const livePrice = resolveDisplayPrice({
      livePrice: prices[symbol],
      quote,
      feed,
      now: now?.getTime?.(),
    })
    const price = Number.isFinite(livePrice) ? livePrice : close * (1 + fallbackPercent / 100)
    const change = Number.isFinite(price) && Number.isFinite(close) ? price - close : null
    const percent = Number.isFinite(change) && close ? (change / close) * 100 : fallbackPercent
    const volume = Number.isFinite(quote?.volume) ? quote.volume : 100000 + ((seed * 919) % 4800000)
    const open = Number.isFinite(quote?.open) ? quote.open : close * (1 + ((seed % 21) - 10) / 900)
    const high = Number.isFinite(quote?.high) ? quote.high : Math.max(open, price) * (1 + ((seed % 13) + 2) / 1000)
    const low = Number.isFinite(quote?.low) ? quote.low : Math.min(open, price) * (1 - ((seed % 11) + 2) / 1000)
    const valueCr = (price * volume) / 10000000
    const bid = Number.isFinite(quote?.depth?.buy?.[0]?.price) ? quote.depth.buy[0].price : price * 0.9997
    const ask = Number.isFinite(quote?.depth?.sell?.[0]?.price) ? quote.depth.sell[0].price : price * 1.0003
    const spread = ask - bid
    const nsePrice = price
    const bsePrice = price * (1 + (((seed % 23) - 11) / 10000))

    return {
      symbol,
      company: quote?.companyName ?? symbol,
      sector: quote?.sector ?? sectorBySymbol[symbol] ?? ['Financials', 'Energy', 'IT', 'Consumer'][index % 4],
      exchange: quote?.exchange ?? 'NSE',
      price,
      close,
      open,
      high,
      low,
      change,
      percent,
      volume,
      valueCr,
      bid,
      ask,
      spread,
      nsePrice,
      bsePrice,
      yearHigh: Number.isFinite(quote?.yearHigh) ? quote.yearHigh : high * 1.1,
      yearLow: Number.isFinite(quote?.yearLow) ? quote.yearLow : low * 0.86,
      seed,
    }
  })
}

export const summarizeMarket = (rows) => {
  const count = rows.length || 1
  const advances = rows.filter((row) => (row.percent ?? 0) > 0).length
  const declines = rows.filter((row) => (row.percent ?? 0) < 0).length
  const unchanged = rows.length - advances - declines
  const weightedMove = rows.reduce((sum, row) => sum + (row.percent ?? 0), 0) / count
  const volume = rows.reduce((sum, row) => sum + (Number(row.volume) || 0), 0)
  const valueCr = rows.reduce((sum, row) => sum + (Number(row.valueCr) || 0), 0)
  const indexValue = 23907.15 * (1 + weightedMove / 100 / 8)

  return {
    indexValue,
    change: indexValue - 23913.7,
    percent: ((indexValue - 23913.7) / 23913.7) * 100,
    prevClose: 23913.7,
    open: 23880.35,
    volumeLakhs: volume / 100000,
    valueCr,
    ffmCap: 109.38,
    advances,
    declines,
    unchanged,
    pe: 20.58,
    pb: 3.26,
  }
}

export const getSignalTone = (value) => {
  if ((value ?? 0) > 0) {
    return 'up'
  }
  if ((value ?? 0) < 0) {
    return 'down'
  }
  return 'neutral'
}
