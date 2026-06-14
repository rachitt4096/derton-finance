import { backendEnabled, getApiUrl } from './backend'

const responseCache = new Map()

const normalizeSymbols = (symbols) =>
  [...new Set((symbols ?? []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))]

export const fetchCompanyInsights = async (symbols, options = {}) => {
  if (!backendEnabled) {
    return []
  }

  const normalizedSymbols = normalizeSymbols(symbols)
  if (!normalizedSymbols.length) {
    return []
  }

  const includeHistory = Boolean(options.includeHistory)
  const historyDays = Number.isFinite(options.historyDays) ? Math.max(1, Number(options.historyDays)) : 30
  const params = new URLSearchParams({
    symbols: normalizedSymbols.join(','),
    includeHistory: includeHistory ? '1' : '0',
    historyDays: String(historyDays),
  })
  const cacheKey = params.toString()

  if (responseCache.has(cacheKey)) {
    return responseCache.get(cacheKey)
  }

  const request = fetch(getApiUrl(`/api/market/company-insights?${params.toString()}`), {
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error ?? `Company insights request failed with HTTP ${response.status}`)
      }

      const payload = await response.json()
      return Array.isArray(payload?.items) ? payload.items : []
    })
    .catch((error) => {
      responseCache.delete(cacheKey)
      throw error
    })

  responseCache.set(cacheKey, request)
  return request
}
