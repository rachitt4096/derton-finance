import { useEffect, useMemo, useState } from 'react'
import { fetchCompanyInsights } from '../utils/companyInsightsApi'

const EMPTY_INSIGHTS_STATE = {
  itemsBySymbol: {},
  isLoading: false,
  error: null,
}

const normalizeSymbols = (symbols) =>
  [...new Set((symbols ?? []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))]

const toMap = (items) =>
  Object.fromEntries((items ?? []).filter((item) => item?.symbol).map((item) => [item.symbol, item]))

function useCompanyInsights(symbols, options = {}) {
  const normalizedSymbols = useMemo(() => normalizeSymbols(symbols), [symbols])
  const includeHistory = Boolean(options.includeHistory)
  const historyDays = Number.isFinite(options.historyDays) ? Number(options.historyDays) : 30
  const hasSymbols = normalizedSymbols.length > 0
  const requestKey = `${normalizedSymbols.join(',')}|${includeHistory ? '1' : '0'}|${historyDays}`
  const [state, setState] = useState(EMPTY_INSIGHTS_STATE)

  useEffect(() => {
    if (!hasSymbols) {
      return undefined
    }

    let isMounted = true

    queueMicrotask(() => {
      if (!isMounted) {
        return
      }

      setState((previous) => ({
        itemsBySymbol: previous.itemsBySymbol,
        isLoading: true,
        error: null,
      }))
    })

    fetchCompanyInsights(normalizedSymbols, { includeHistory, historyDays })
      .then((items) => {
        if (!isMounted) {
          return
        }

        setState({
          itemsBySymbol: toMap(items),
          isLoading: false,
          error: null,
        })
      })
      .catch((error) => {
        if (!isMounted) {
          return
        }

        setState({
          itemsBySymbol: {},
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unable to load company insights',
        })
      })

    return () => {
      isMounted = false
    }
  }, [hasSymbols, historyDays, includeHistory, normalizedSymbols, requestKey])

  return hasSymbols ? state : EMPTY_INSIGHTS_STATE
}

export default useCompanyInsights
