import { useEffect } from 'react'
import useMarketStore from '../store/useMarketStore'
import { fetchMarketQuotes } from '../utils/terminalApi'
import { wsTickFreshWithin } from '../utils/feedActivity'

const REST_QUOTE_POLL_MS = 15_000
// Back off REST only if a real WebSocket tick arrived more recently than this.
const WS_TICK_FRESH_MS = 6_000

// When the live WebSocket feed isn't fresh (market closed, off-hours, or feed
// down), pull last-traded / previous-close quotes over REST so every screen
// still shows prior-session data instead of blanks.
const useRestQuotes = () => {
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol)
  const watchlistSymbols = useMarketStore((state) => state.watchlistSymbols)
  const activeSymbols = useMarketStore((state) => state.activeSymbols)
  const setMarketQuotes = useMarketStore((state) => state.setMarketQuotes)
  const setQuoteHealth = useMarketStore((state) => state.setQuoteHealth)
  const setFeed = useMarketStore((state) => state.setFeed)

  const symbolKey = [
    selectedSymbol,
    ...(watchlistSymbols ?? []),
    ...(activeSymbols ?? []),
  ]
    .filter(Boolean)
    .join(',')

  useEffect(() => {
    const symbols = symbolKey.split(',').filter(Boolean)
    if (!symbols.length) {
      return undefined
    }

    let active = true

    const load = async () => {
      // Skip only when the WebSocket is genuinely streaming real ticks (not when
      // REST itself last updated the feed — that caused a 2-min stale window).
      if (wsTickFreshWithin(WS_TICK_FRESH_MS)) {
        return
      }
      try {
        const quotes = await fetchMarketQuotes(symbols)
        if (!active || !Object.keys(quotes).length) {
          return
        }
        const now = Date.now()
        const current = useMarketStore.getState().marketQuotes
        setMarketQuotes({ ...current, ...quotes })
        setQuoteHealth({
          status: 'ready',
          error: null,
          lastSuccessAt: now,
        })
        setFeed({
          source: 'upstox',
          status: 'live',
          latencyMs: null,
          lastSuccessAt: now,
          lastError: null,
          retryInMs: null,
        })
      } catch {
        // Silent — the feed/health badges already surface backend issues.
      }
    }

    load()
    const timer = setInterval(load, REST_QUOTE_POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [symbolKey, setFeed, setMarketQuotes, setQuoteHealth])
}

export default useRestQuotes
