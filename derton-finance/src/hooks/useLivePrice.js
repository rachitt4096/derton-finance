import { useEffect, useRef } from 'react'
import useMarketStore from '../store/useMarketStore'
import { getWsUrl } from '../utils/backend'
import { markWsTick } from '../utils/feedActivity'

const API_ERROR_TOAST_COOLDOWN_MS = 15000
const BACKEND_RECONNECT_BASE_MS = 1500
const BACKEND_RECONNECT_CAP_MS = 15000
const BACKEND_STALE_SOCKET_MS = 5000
const SOCKET_CONNECT_TIMEOUT_MS = 10000
const HOUSEKEEPING_TICK_MS = 1000
const BACKEND_WS_URL = getWsUrl()

const useLivePrice = () => {
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const activeSymbols = useMarketStore((state) => state.activeSymbols)
  const setPrices = useMarketStore((state) => state.setPrices)
  const setMarketQuotes = useMarketStore((state) => state.setMarketQuotes)
  const setQuoteHealth = useMarketStore((state) => state.setQuoteHealth)
  const setNow = useMarketStore((state) => state.setNow)
  const addToast = useMarketStore((state) => state.addToast)
  const setFeed = useMarketStore((state) => state.setFeed)
  const setWatchlistSymbols = useMarketStore((state) => state.setWatchlistSymbols)
  const socketRef = useRef(null)
  const lastMessageAtRef = useRef(0)
  const connectStartedAtRef = useRef(0)

  useEffect(() => {
    if (!BACKEND_WS_URL) {
      setFeed({
        source: 'upstox',
        status: 'offline',
        latencyMs: null,
        lastError: 'Backend WebSocket is not configured.',
        retryInMs: null,
      })
      return undefined
    }

    let isMounted = true
    let allowReconnect = true
    let reconnectAttempts = 0
    let reconnectTimeout = null
    let initialConnectTimeout = null
    let housekeepingTimer = null
    let socket = null
    let lastErrorToastAt = 0

    const maybeToast = (message) => {
      const now = Date.now()
      if (now - lastErrorToastAt >= API_ERROR_TOAST_COOLDOWN_MS) {
        addToast(message, 'w', 4500)
        lastErrorToastAt = now
      }
    }

    const clearReconnectTimeout = () => {
      window.clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    const sendCurrentSubscriptions = (targetSocket) => {
      if (!targetSocket || targetSocket.readyState !== window.WebSocket.OPEN) {
        return
      }

      const { selectedSymbol: currentSelectedSymbol, activeSymbols: currentActiveSymbols } = useMarketStore.getState()

      if (currentSelectedSymbol) {
        targetSocket.send(JSON.stringify({ type: 'focus.set', symbol: currentSelectedSymbol }))
      }

      targetSocket.send(
        JSON.stringify({
          type: 'symbols.set',
          symbols: currentActiveSymbols ?? [],
        }),
      )
    }

    const closeSocket = () => {
      const currentSocket = socketRef.current
      if (
        currentSocket &&
        (currentSocket.readyState === window.WebSocket.OPEN || currentSocket.readyState === window.WebSocket.CONNECTING)
      ) {
        currentSocket.close()
      }
    }

    const scheduleReconnect = (reason) => {
      if (!isMounted || !allowReconnect) {
        return
      }

      clearReconnectTimeout()

      const retryInMs = Math.min(
        BACKEND_RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempts, 4),
        BACKEND_RECONNECT_CAP_MS,
      )
      reconnectAttempts += 1

      setFeed({
        source: 'upstox',
        status: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting',
        latencyMs: null,
        lastError: reason,
        retryInMs,
      })

      reconnectTimeout = window.setTimeout(() => {
        void connectSocket()
      }, retryInMs)
    }

    const handleSocketMessage = (event) => {
      lastMessageAtRef.current = Date.now()

      let message = null

      try {
        message = JSON.parse(event.data)
      } catch {
        maybeToast('Received an invalid live-data payload from the backend.')
        return
      }

      if (!message || typeof message !== 'object') {
        return
      }

      if (message.type === 'session.ready') {
        if (Array.isArray(message.watchlist)) {
          setWatchlistSymbols(message.watchlist)
        }
        if (message.feedStatus?.error) {
          setQuoteHealth({
            status: 'error',
            error: message.feedStatus.error,
          })
        }
        setFeed({
          source: message.feedStatus?.source ?? 'upstox',
          status: message.feedStatus?.status ?? 'connecting',
          latencyMs: null,
          lastSuccessAt: message.feedStatus?.lastTickAt ?? null,
          lastError: message.feedStatus?.error ?? null,
          retryInMs: message.feedStatus?.retryInMs ?? null,
        })
        sendCurrentSubscriptions(socket)
        return
      }

      if (message.type === 'feed.status') {
        setFeed({
          source: message.source ?? 'upstox',
          status: message.status ?? 'degraded',
          latencyMs: null,
          lastSuccessAt: message.lastTickAt ?? null,
          lastError: message.error ?? null,
          retryInMs: message.retryInMs ?? null,
        })

        if (message.error) {
          setQuoteHealth({
            status: 'error',
            error: message.error,
          })
          maybeToast('Live feed is delayed. The terminal will keep retrying automatically.')
        }
        return
      }

      if (message.type === 'market.snapshot') {
        const currentState = useMarketStore.getState()

        // Merge prices, but only commit to the store if something actually
        // changed — the backend re-broadcasts every 500ms even when the market
        // is closed, and committing identical data would re-render the whole
        // tree 2x/second (freezes the page).
        let pricesChanged = false
        const nextPrices = { ...currentState.prices }
        Object.entries(message.prices ?? {}).forEach(([symbol, livePrice]) => {
          if (Number.isFinite(livePrice) && livePrice > 0 && nextPrices[symbol] !== livePrice) {
            nextPrices[symbol] = livePrice
            pricesChanged = true
          }
        })
        if (pricesChanged) {
          setPrices(nextPrices)
        }

        const incomingQuotes = Object.fromEntries(
          Object.entries(message.quotes ?? {}).filter(([, quote]) => quote && typeof quote === 'object'),
        )
        const tsNow = Number.isFinite(message.ts) ? message.ts : Date.now()
        if (Object.keys(incomingQuotes).length) {
          setMarketQuotes({
            ...currentState.marketQuotes,
            ...incomingQuotes,
          })
          setQuoteHealth({
            status: 'ready',
            error: null,
            lastSuccessAt: tsNow,
          })
        }

        // Only touch the feed when a meaningful field changes (the 1s
        // housekeeping timer owns the clock, so we don't setNow here).
        const prevFeed = currentState.feed
        const hasSnapshotData =
          Object.keys(message.prices ?? {}).length > 0 ||
          Object.keys(incomingQuotes).length > 0
        if (hasSnapshotData) {
          // Real WS tick — lets REST polling back off while the socket streams.
          markWsTick()
        }
        const nextStatus =
          message.marketState === 'live' ||
          message.marketState === 'degraded' ||
          message.marketState === 'offline' ||
          hasSnapshotData
            ? (message.marketState ?? 'live')
            : prevFeed.status
        const nextLastSuccess = Number.isFinite(message.lastTickAt)
          ? message.lastTickAt
          : prevFeed.lastSuccessAt ?? null
        if (
          prevFeed.source !== (message.source ?? 'upstox') ||
          prevFeed.status !== nextStatus ||
          prevFeed.lastSuccessAt !== nextLastSuccess ||
          prevFeed.lastError !== null
        ) {
          setFeed({
            source: message.source ?? 'upstox',
            status: nextStatus,
            latencyMs: Number.isFinite(message.snapshotAgeMs) ? message.snapshotAgeMs : null,
            lastSuccessAt: nextLastSuccess,
            lastError: null,
            retryInMs: null,
          })
        }
        return
      }

      if (message.type === 'error') {
        setQuoteHealth({
          status: 'error',
          error: message.message ?? 'WebSocket error',
        })
        setFeed({
          source: 'upstox',
          status: 'degraded',
          latencyMs: null,
          lastError: message.message ?? 'WebSocket error',
        })
        maybeToast(message.message ?? 'Backend connection failed.')
      }
    }

    const connectSocket = async ({ force = false } = {}) => {
      if (!isMounted || !allowReconnect) {
        return
      }

      const existingSocket = socketRef.current
      if (existingSocket) {
        if (!force && (existingSocket.readyState === window.WebSocket.OPEN || existingSocket.readyState === window.WebSocket.CONNECTING)) {
          return
        }

        if (force && (existingSocket.readyState === window.WebSocket.OPEN || existingSocket.readyState === window.WebSocket.CONNECTING)) {
          existingSocket.close()
        }
      }

      clearReconnectTimeout()
      connectStartedAtRef.current = Date.now()
      lastMessageAtRef.current = Date.now()
      lastMessageAtRef.current = Date.now()

      setFeed({
        source: 'upstox',
        status: 'connecting',
        latencyMs: null,
        lastError: null,
        retryInMs: null,
      })

      socket = new window.WebSocket(BACKEND_WS_URL)
      socketRef.current = socket

      socket.addEventListener('open', () => {
        reconnectAttempts = 0
        connectStartedAtRef.current = Date.now()
        setFeed({
          source: 'upstox',
          status: 'connecting',
          latencyMs: null,
          lastError: null,
          retryInMs: null,
        })
        socket?.send(JSON.stringify({ type: 'session.init' }))
      })

      socket.addEventListener('message', handleSocketMessage)

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) {
          socketRef.current = null
        } else if (socketRef.current) {
          return
        }
        if (!allowReconnect) {
          return
        }

        scheduleReconnect('Live socket disconnected')
      })

      socket.addEventListener('error', () => {
        if (socket?.readyState === window.WebSocket.OPEN || socket?.readyState === window.WebSocket.CONNECTING) {
          socket.close()
        }
      })
    }

    const handleOnline = () => {
      reconnectAttempts = 0
      void connectSocket({ force: true })
    }

    const handleOffline = () => {
      clearReconnectTimeout()
      closeSocket()
      setFeed({
        source: 'upstox',
        status: 'offline',
        latencyMs: null,
        lastError: 'Network offline',
        retryInMs: null,
      })
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }

      const socketState = socketRef.current?.readyState
      const staleSocket = Date.now() - lastMessageAtRef.current > BACKEND_STALE_SOCKET_MS
      if (
        socketState !== window.WebSocket.OPEN ||
        staleSocket
      ) {
        reconnectAttempts = 0
        void connectSocket({ force: true })
      }
    }

    housekeepingTimer = window.setInterval(() => {
      setNow(new Date())

      const toasts = useMarketStore.getState().toasts
      const removeToast = useMarketStore.getState().removeToast
      const now = Date.now()

      toasts.forEach((toast) => {
        const [timePart] = toast.id.split('-')
        const created = Number(timePart)
        if (Number.isFinite(created) && now - created >= toast.duration) {
          removeToast(toast.id)
        }
      })

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return
      }

      const currentSocket = socketRef.current
      if (currentSocket?.readyState === window.WebSocket.OPEN) {
        const silentForMs = now - lastMessageAtRef.current
        if (silentForMs > BACKEND_STALE_SOCKET_MS) {
          setFeed({
            source: 'upstox',
            status: 'degraded',
            latencyMs: silentForMs,
            lastError: 'Live feed heartbeat missed. Reconnecting automatically.',
            retryInMs: null,
          })
          currentSocket.close()
        }
        return
      }

      if (currentSocket?.readyState === window.WebSocket.CONNECTING) {
        const connectingForMs = now - connectStartedAtRef.current
        if (connectingForMs > SOCKET_CONNECT_TIMEOUT_MS) {
          currentSocket.close()
        }
      }
    }, HOUSEKEEPING_TICK_MS)

    initialConnectTimeout = window.setTimeout(() => {
      void connectSocket()
    }, 0)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      isMounted = false
      allowReconnect = false
      window.clearTimeout(initialConnectTimeout)
      clearReconnectTimeout()
      window.clearInterval(housekeepingTimer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      closeSocket()
      socketRef.current = null
    }
  }, [addToast, setFeed, setMarketQuotes, setNow, setPrices, setQuoteHealth, setWatchlistSymbols])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== window.WebSocket.OPEN || !selectedSymbol) {
      return
    }

    socket.send(JSON.stringify({ type: 'focus.set', symbol: selectedSymbol }))
  }, [selectedSymbol])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== window.WebSocket.OPEN) {
      return
    }

    socket.send(
      JSON.stringify({
        type: 'symbols.set',
        symbols: activeSymbols,
      }),
    )
  }, [activeSymbols])
}

export default useLivePrice
