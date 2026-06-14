import useMarketStore from '../../store/useMarketStore'
import useThemeStore from '../../store/useThemeStore'
import { formatTime } from '../../utils/formatters'
import { getNseMarketWindowState, isNseRegularSessionOpen } from '../../utils/marketSession'
import TopNav from './TopNav'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'warm', label: 'Warm' },
]

const STALE_FEED_BADGE_MS = 15_000
const FRESH_REST_QUOTE_MS = 45_000

function Topbar({ onLogout, session }) {
  const now = useMarketStore((state) => state.now)
  const feed = useMarketStore((state) => state.feed)
  const quoteHealth = useMarketStore((state) => state.quoteHealth)
  const marketQuotes = useMarketStore((state) => state.marketQuotes)

  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  const badgeByStatus = {
    live: { label: 'LIVE', className: 'live' },
    connecting: { label: 'SYNC', className: 'connecting' },
    degraded: { label: 'DELAY', className: 'degraded' },
    offline: { label: 'OFF', className: 'offline' },
    idle: { label: 'WAIT', className: 'connecting' },
  }
  const marketWindowState = getNseMarketWindowState(now)
  const regularSessionOpen = isNseRegularSessionOpen(now)

  const quoteAuthFailed = quoteHealth.status === 'error' && /reconnect upstox|auth/i.test(quoteHealth.error ?? '')
  const lastSuccessAgeMs =
    typeof feed.lastSuccessAt === 'number' ? Math.max(0, now.getTime() - feed.lastSuccessAt) : null
  const lastQuoteSuccessAgeMs =
    typeof quoteHealth.lastSuccessAt === 'number' ? Math.max(0, now.getTime() - quoteHealth.lastSuccessAt) : null
  const latestQuoteAt = Object.values(marketQuotes ?? {}).reduce((latest, quote) => {
    const fetchedAt = Number.isFinite(quote?.fetchedAt) ? quote.fetchedAt : null
    const timestampAt = quote?.timestamp ? Date.parse(quote.timestamp) : NaN
    const quoteAt = fetchedAt ?? (Number.isFinite(timestampAt) ? timestampAt : null)
    return Number.isFinite(quoteAt) ? Math.max(latest, quoteAt) : latest
  }, 0)
  const hasAnyQuote = Object.values(marketQuotes ?? {}).some(
    (quote) => Number.isFinite(quote?.lastPrice) || Number.isFinite(quote?.sessionClose),
  )
  const latestQuoteAgeMs = latestQuoteAt > 0 ? Math.max(0, now.getTime() - latestQuoteAt) : null
  const hasFreshQuoteSnapshot =
    (quoteHealth.status === 'ready' &&
      Number.isFinite(lastQuoteSuccessAgeMs) &&
      lastQuoteSuccessAgeMs <= FRESH_REST_QUOTE_MS) ||
    (Number.isFinite(latestQuoteAgeMs) && latestQuoteAgeMs <= FRESH_REST_QUOTE_MS) ||
    (hasAnyQuote && feed.status === 'degraded' && !feed.lastError)
  const staleFeed =
    feed.status === 'live' &&
    Number.isFinite(lastSuccessAgeMs) &&
    lastSuccessAgeMs > STALE_FEED_BADGE_MS
  const activeBadge = !regularSessionOpen
    ? { label: marketWindowState.badgeLabel, className: marketWindowState.className }
    : quoteAuthFailed
      ? { label: 'AUTH ERR', className: 'offline' }
      : hasFreshQuoteSnapshot
        ? badgeByStatus.live
      : staleFeed
        ? badgeByStatus.degraded
      : badgeByStatus[feed.status] ?? badgeByStatus.idle
  const feedMeta = quoteHealth.status === 'error'
    ? quoteHealth.error
    : feed.status === 'offline'
      ? 'No net'
      : Number.isFinite(feed.latencyMs)
        ? `${Math.round(feed.latencyMs)} ms`
        : Number.isFinite(feed.retryInMs)
          ? `retry ${Math.ceil(feed.retryInMs / 1000)}s`
          : Number.isFinite(lastSuccessAgeMs) && lastSuccessAgeMs >= 1000
            ? `updated ${Math.floor(lastSuccessAgeMs / 1000)}s ago`
            : feed.source === 'upstox'
              ? 'Broker feed'
              : '--'

  return (
    <header id="topbar">
      <div className="logo">
        <div className="logo-hex" />
        <div>
          <div className="logo-name">
            DERTON <span>FINANCE</span>
          </div>
          <div className="logo-sub">PVT LTD · TERMINAL v6 · NSE/BSE</div>
        </div>
      </div>

      <TopNav session={session} />

      <div className="topbar-right">
        <div className="market-pill">
          MARKET
          <span>
            <span className={`live-dot ${activeBadge.className}`} />
            {activeBadge.label}
          </span>
        </div>
        <div id="clock" title={feedMeta}>{formatTime(now)}</div>

        <div className="theme-group">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`th-btn ${theme === option.value ? 'on' : ''}`}
              onClick={() => setTheme(option.value)}
              title={option.label}
            >
              {option.label}
            </button>
          ))}
        </div>
        {onLogout ? (
          <button
            type="button"
            className="nav-btn logout-btn"
            onClick={onLogout}
            title={session?.userId ? `Signed in as ${session.userId}` : 'Sign out'}
          >
            Logout
          </button>
        ) : null}
      </div>
    </header>
  )
}

export default Topbar
