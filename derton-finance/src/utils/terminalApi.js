import { backendEnabled, getApiUrl } from './backend'

const requestJson = async (path, options = {}) => {
  if (!backendEnabled) {
    throw new Error('Backend is not configured.')
  }

  const response = await fetch(getApiUrl(path), {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.headers ?? {}),
    },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error ?? `Request failed with HTTP ${response.status}`)
  }

  return response.json()
}

export const fetchPortfolioSummary = async () => requestJson('/api/portfolio/summary')

export const fetchPortfolioHoldings = async () => {
  const payload = await requestJson('/api/portfolio/holdings')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const fetchPortfolioTransactions = async () => {
  const payload = await requestJson('/api/portfolio/transactions')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const createPortfolioTransaction = async (input) =>
  requestJson('/api/portfolio/transactions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })

export const fetchOpeningWindow = async () => {
  const payload = await requestJson('/api/opening-window')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const fetchFlags = async () => {
  const payload = await requestJson('/api/flags')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const fetchOptionExpiries = async (underlying) =>
  requestJson(`/api/market/option-expiries?underlying=${encodeURIComponent(underlying)}`)

export const fetchOptionChain = async (underlying, expiry) =>
  requestJson(
    `/api/market/option-chain?underlying=${encodeURIComponent(underlying)}&expiry=${encodeURIComponent(expiry)}`,
  )

export const fetchAlerts = async () => {
  const payload = await requestJson('/api/alerts')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const createAlert = async (input) =>
  requestJson('/api/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })

export const updateAlertStatus = async (id, status) =>
  requestJson(`/api/alerts/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })

export const deleteAlert = async (id) => requestJson(`/api/alerts/${id}`, { method: 'DELETE' })

export const fetchCommodities = async () => {
  const payload = await requestJson('/api/market/commodities')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const fetchCommodityHistory = async (name, { interval = '1d', days = 30, date = null } = {}) => {
  const params = new URLSearchParams({ interval, days: String(days) })
  if (date) params.set('date', date)
  return requestJson(`/api/market/commodities/${encodeURIComponent(name)}/history?${params.toString()}`)
}

export const fetchAiStatus = async () => requestJson('/api/ai/status')

export const sendAiChat = async ({ message, context, history }) =>
  requestJson('/api/ai/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, context, history }),
  })

// Raw historical candles for a symbol. When `date` is given the backend returns
// that single session; otherwise the trailing `days` window.
export const fetchMarketHistory = async ({ symbol, interval = '1m', date = null, days = 1 }) => {
  const params = new URLSearchParams({ symbol: String(symbol).toUpperCase(), interval, days: String(days) })
  if (date) {
    params.set('date', date)
  }
  const payload = await requestJson(`/api/market/history?${params.toString()}`)
  return Array.isArray(payload?.candles) ? payload.candles : []
}

// Maps a snake_case REST quote item to the camelCase shape the UI/store expects
// (the same shape WebSocket snapshots deliver).
const mapRestQuote = (item) => ({
  symbol: item.symbol,
  companyName: item.company_name ?? item.symbol,
  exchange: item.exchange ?? null,
  instrumentKey: item.instrument_key ?? null,
  lastPrice: item.last_price ?? null,
  sessionClose: item.session_close ?? null,
  open: item.open ?? null,
  high: item.high ?? null,
  low: item.low ?? null,
  close: item.close ?? null,
  volume: item.volume ?? null,
  averagePrice: item.average_price ?? null,
  netChange: item.net_change ?? null,
  percentChange: item.percent_change ?? null,
  upperCircuitLimit: item.upper_circuit_limit ?? null,
  lowerCircuitLimit: item.lower_circuit_limit ?? null,
  yearHigh: item.year_high ?? null,
  yearLow: item.year_low ?? null,
  yearHighDate: item.year_high_date ?? null,
  yearLowDate: item.year_low_date ?? null,
  dailyVolatility: item.daily_volatility ?? null,
  annualisedVolatility: item.annualised_volatility ?? null,
  fetchedAt: Date.now(),
  timestamp: item.timestamp ?? null,
})

// Fetches REST quotes for the given symbols and returns a map keyed by symbol.
export const fetchMarketQuotes = async (symbols) => {
  const list = [...new Set((symbols ?? []).filter(Boolean).map((s) => String(s).toUpperCase()))]
  if (!list.length) {
    return {}
  }
  const payload = await requestJson(`/api/market/quotes?symbols=${encodeURIComponent(list.join(','))}`)
  const items = Array.isArray(payload?.items) ? payload.items : []
  return Object.fromEntries(items.map((item) => [item.symbol, mapRestQuote(item)]))
}

export const fetchAdminOverview = async () => requestJson('/api/admin/overview')

export const fetchAdminUsers = async () => {
  const payload = await requestJson('/api/admin/users')
  return Array.isArray(payload?.items) ? payload.items : []
}

export const createAdminUser = async (input) =>
  requestJson('/api/admin/users', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })

export const updateAdminUser = async (userId, input) =>
  requestJson(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  })

export const resetAdminUserPassword = async (userId, password) =>
  requestJson(`/api/admin/users/${userId}/reset-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })

export const revokeAdminUserSessions = async (userId) =>
  requestJson(`/api/admin/users/${userId}/revoke-sessions`, {
    method: 'POST',
  })
