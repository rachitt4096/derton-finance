import { backendEnabled, getApiUrl } from './backend'

const normalizeSymbolList = (symbols) =>
  [...new Set((symbols ?? []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))]

export const fetchDefaultWatchlist = async () => {
  if (!backendEnabled) {
    return null
  }

  const response = await fetch(getApiUrl('/api/watchlists/default'), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Watchlist request failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  return normalizeSymbolList(payload?.symbols ?? [])
}

export const saveDefaultWatchlist = async (symbols) => {
  if (!backendEnabled) {
    return normalizeSymbolList(symbols)
  }

  const response = await fetch(getApiUrl('/api/watchlists/default'), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      symbols: normalizeSymbolList(symbols),
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error ?? `Watchlist save failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  return normalizeSymbolList(payload?.symbols ?? [])
}

export const searchBackendInstruments = async (query, limit = 10) => {
  if (!backendEnabled) {
    return []
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })

  const response = await fetch(getApiUrl(`/api/instruments/search?${params.toString()}`), {
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(`Search request failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  return Array.isArray(payload?.items) ? payload.items : []
}
