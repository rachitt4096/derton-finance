import { useEffect, useMemo, useRef, useState } from 'react'
import { backendEnabled, getApiUrl } from '../utils/backend.js'

const candleCache = new Map()

const TIMEFRAME_HISTORY_MAP = {
  '1m': { days: 1, interval: '1m' },
  '5m': { days: 5, interval: '5m' },
  '15m': { days: 15, interval: '15m' },
  '1H': { days: 30, interval: '1h' },
  '1D': { days: 2, interval: '1m' },
  '1W': { days: 30, interval: '1h' },
  '1M': { days: 90, interval: '1d' },
  '3Y': { days: 1095, interval: '1d' },
}

const LIVE_HISTORY_REFRESH_MS = 15000
const LIVE_HISTORY_RECOVERY_MS = 3000
const DAY_MS = 24 * 60 * 60 * 1000

const TIMEFRAME_BUCKET_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1H': 60 * 60 * 1000,
  '1D': 60 * 1000,
  '1W': 60 * 60 * 1000,
  '1M': DAY_MS,
  '3Y': DAY_MS,
}

const getSessionKey = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const getTodaySessionKey = () => getSessionKey(new Date())

const isLiveSessionTimeframe = (timeframe, sessionDate) =>
  ['1m', '5m', '15m', '1H'].includes(timeframe) || (timeframe === '1D' && sessionDate === getTodaySessionKey())

const getTimeframeBucketMs = (timeframe) => TIMEFRAME_BUCKET_MS[timeframe] ?? TIMEFRAME_BUCKET_MS['1D']

const snapToBucketStart = (date, timeframe) => {
  const timestamp = date.getTime()
  if (!Number.isFinite(timestamp)) {
    return null
  }

  const bucketMs = getTimeframeBucketMs(timeframe)
  return new Date(Math.floor(timestamp / bucketMs) * bucketMs)
}

const selectSession = (candles, selectedDate = null) => {
  if (!candles.length) {
    return candles
  }

  const grouped = new Map()
  candles.forEach((candle) => {
    const key = getSessionKey(candle.t)
    const rows = grouped.get(key) ?? []
    rows.push(candle)
    grouped.set(key, rows)
  })

  if (selectedDate) {
    return grouped.get(selectedDate) ?? []
  }

  const targetKey = [...grouped.keys()].sort().at(-1)
  return targetKey ? grouped.get(targetKey) ?? candles : candles
}

export const normalizeBackendCandles = (candles, timeframe, selectedDate = null) => {
  const bucketed = candles
    .map((candle) => ({
      o: Number(candle.open),
      h: Number(candle.high),
      l: Number(candle.low),
      c: Number(candle.close),
      v: Number(candle.volume ?? 0),
      t: snapToBucketStart(new Date(candle.time), timeframe),
    }))
    .filter(
      (candle) =>
        Number.isFinite(candle.o) &&
        Number.isFinite(candle.h) &&
        Number.isFinite(candle.l) &&
        Number.isFinite(candle.c) &&
        candle.t instanceof Date &&
        Number.isFinite(candle.t.getTime()),
    )
    .sort((left, right) => left.t.getTime() - right.t.getTime())

  const normalized = []

  for (const candle of bucketed) {
    const previous = normalized[normalized.length - 1]
    if (previous && previous.t.getTime() === candle.t.getTime()) {
      previous.h = Math.max(previous.h, candle.h)
      previous.l = Math.min(previous.l, candle.l)
      previous.c = candle.c
      previous.v += candle.v
      continue
    }

    normalized.push(candle)
  }

  if (timeframe === '1D') {
    return selectSession(normalized, selectedDate)
  }

  return normalized
}

export const normalizePreferredHistoryCandles = ({
  primaryCandles = [],
  fallbackCandles = [],
  timeframe,
  selectedDate = null,
}) => {
  const primary = normalizeBackendCandles(primaryCandles, timeframe, selectedDate)
  if (primary.length || !fallbackCandles.length) {
    return primary
  }

  // The requested session (e.g. today) had no candles — fall back to the most
  // recent available session instead of filtering the fallback to that same
  // empty date.
  return normalizeBackendCandles(fallbackCandles, timeframe, null)
}

const buildHistoryParams = ({ symbol, historyConfig, sessionDate = null, includeSessionDate = true }) => {
  const params = new URLSearchParams({
    symbol,
    days: String(historyConfig.days),
    interval: historyConfig.interval,
  })

  if (includeSessionDate && sessionDate) {
    params.set('date', sessionDate)
  }

  return params
}

const requestHistoryCandles = async ({
  symbol,
  historyConfig,
  sessionDate = null,
  includeSessionDate = true,
  signal,
}) => {
  const params = buildHistoryParams({ symbol, historyConfig, sessionDate, includeSessionDate })
  const response = await fetch(getApiUrl(`/api/market/history?${params.toString()}`), {
    credentials: 'include',
    signal,
  })

  if (!response.ok) {
    throw new Error(`History request failed with HTTP ${response.status}`)
  }

  const payload = await response.json()
  return payload?.candles ?? []
}

const useChartData = ({ symbol, timeframe, selectedDate = null }) => {
  const sessionDate = timeframe === '1D' ? selectedDate ?? getTodaySessionKey() : null
  const chartKey = `${symbol}-${timeframe}-${sessionDate ?? 'latest'}`
  const [remoteCandles, setRemoteCandles] = useState(null)
  const latestCandlesRef = useRef(null)
  const liveHistory = isLiveSessionTimeframe(timeframe, sessionDate)

  useEffect(() => {
    latestCandlesRef.current = remoteCandles
  }, [remoteCandles])

  useEffect(() => {
    if (!backendEnabled) {
      setRemoteCandles(null)
      return undefined
    }

    const historyConfig = TIMEFRAME_HISTORY_MAP[timeframe] ?? TIMEFRAME_HISTORY_MAP['1D']
    const cacheKey = `remote:${chartKey}:${historyConfig.days}:${historyConfig.interval}`
    const cached = candleCache.get(cacheKey)
    if (cached?.length) {
      setRemoteCandles(cached)
    }

    if (cached?.length && !liveHistory) {
      return undefined
    }

    let isMounted = true
    const controller = new AbortController()
    let refreshTimer = null
    let recoveryTimer = null

    const clearRecoveryTimer = () => {
      if (recoveryTimer !== null) {
        window.clearTimeout(recoveryTimer)
        recoveryTimer = null
      }
    }

    const scheduleRecovery = () => {
      if (!liveHistory || recoveryTimer !== null) {
        return
      }

      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null
        void loadHistory({ useCache: false })
      }, LIVE_HISTORY_RECOVERY_MS)
    }

    const loadHistory = async ({ useCache = true } = {}) => {
      try {
        if (useCache) {
          const cachedCandles = candleCache.get(cacheKey)
          if (cachedCandles?.length && !liveHistory) {
            setRemoteCandles(cachedCandles)
            return
          }

          if (cachedCandles?.length && latestCandlesRef.current === null) {
            setRemoteCandles(cachedCandles)
          }
        }

        let primaryCandles = []
        let fallbackCandles = []
        let primaryError = null
        let fallbackError = null

        try {
          primaryCandles = await requestHistoryCandles({
            symbol,
            historyConfig,
            timeframe,
            sessionDate,
            includeSessionDate: true,
            signal: controller.signal,
          })
        } catch (error) {
          primaryError = error
        }

        if (timeframe === '1D' && sessionDate && (!primaryCandles.length || primaryError)) {
          try {
            fallbackCandles = await requestHistoryCandles({
              symbol,
              historyConfig,
              timeframe,
              sessionDate,
              includeSessionDate: false,
              signal: controller.signal,
            })
          } catch (error) {
            fallbackError = error
          }
        }

        const normalized = normalizePreferredHistoryCandles({
          primaryCandles,
          fallbackCandles,
          timeframe,
          selectedDate: sessionDate,
        })

        if (!normalized.length && primaryError) {
          throw primaryError
        }

        if (!normalized.length && fallbackError) {
          throw fallbackError
        }

        if (!isMounted) {
          return
        }

        if (normalized.length) {
          clearRecoveryTimer()
          candleCache.set(cacheKey, normalized)
          setRemoteCandles(normalized)
          return
        }

        const staleCandles = candleCache.get(cacheKey) ?? latestCandlesRef.current
        if (staleCandles?.length) {
          setRemoteCandles(staleCandles)
          scheduleRecovery()
          return
        }

        setRemoteCandles(null)
      } catch (error) {
        if (error?.name === 'AbortError' || !isMounted) {
          return
        }

        const staleCandles = candleCache.get(cacheKey) ?? latestCandlesRef.current
        if (staleCandles?.length) {
          setRemoteCandles(staleCandles)
        } else {
          setRemoteCandles(null)
        }

        scheduleRecovery()
      }
    }

    // Always paint from cache on mount (even for live timeframes) so re-selecting
    // a symbol is instant; the background fetch below still refreshes the data.
    void loadHistory({ useCache: true })

    if (liveHistory) {
      refreshTimer = window.setInterval(() => {
        void loadHistory({ useCache: false })
      }, LIVE_HISTORY_REFRESH_MS)
    }

    return () => {
      isMounted = false
      window.clearInterval(refreshTimer)
      clearRecoveryTimer()
      controller.abort()
    }
  }, [chartKey, liveHistory, sessionDate, symbol, timeframe])

  return useMemo(() => remoteCandles ?? [], [remoteCandles])
}

export default useChartData
