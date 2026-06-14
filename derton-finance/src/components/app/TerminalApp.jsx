import { Suspense, lazy, useEffect, useMemo, useState } from 'react'

import Topbar from '../layout/Topbar'
import LeftNav from '../layout/LeftNav'
import IndexBar from '../layout/IndexBar'
import AssistantFab from '../ai/AssistantFab'
import Toast from '../ui/Toast'
import Calendar from '../ui/Calendar'
import Modal from '../ui/Modal'
import LoadingPanel from '../ui/LoadingPanel'

import useLivePrice from '../../hooks/useLivePrice'
import useRestQuotes from '../../hooks/useRestQuotes'
import useExport from '../../hooks/useExport'

import useThemeStore from '../../store/useThemeStore'
import useMarketStore from '../../store/useMarketStore'
import { resolveDisplayPrice } from '../../utils/marketPrice'
import { primeAlertAudio } from '../../utils/soundAlerts'

const Dashboard = lazy(() => import('../../pages/Dashboard'))
const StockDetail = lazy(() => import('../../pages/StockDetail'))
const Screener = lazy(() => import('../../pages/Screener'))
const Portfolio = lazy(() => import('../../pages/Portfolio'))
const OpeningWindow = lazy(() => import('../../pages/OpeningWindow'))
const FlagsWarnings = lazy(() => import('../../pages/FlagsWarnings'))
const AdminTerminal = lazy(() => import('../../pages/AdminTerminal'))
const Markets = lazy(() => import('../../pages/workspaces/Markets'))
const Arbitrage = lazy(() => import('../../pages/workspaces/Arbitrage'))
const AICopilot = lazy(() => import('../../pages/workspaces/AICopilot'))
const AIInsights = lazy(() => import('../../pages/workspaces/AIInsights'))
const Alerts = lazy(() => import('../../pages/workspaces/Alerts'))
const TradeJournal = lazy(() => import('../../pages/workspaces/TradeJournal'))
const Options = lazy(() => import('../../pages/workspaces/Options'))
const Commodities = lazy(() => import('../../pages/workspaces/Commodities'))
const History = lazy(() => import('../../pages/workspaces/History'))
const Settings = lazy(() => import('../../pages/workspaces/Settings'))

const EXPORT_OPTIONS = [
  { key: 'pdf', title: 'PDF Report', subtitle: 'Full company analysis' },
  { key: 'excel', title: 'Excel Data', subtitle: 'All data and charts' },
  { key: 'csv', title: 'CSV Data', subtitle: 'Portable table export' },
  { key: 'print', title: 'Print', subtitle: 'Print current view' },
  { key: 'img', title: 'Chart Image', subtitle: 'Save current chart as PNG' },
]

const SCREEN_TITLES = {
  dashboard: 'Dashboard',
  markets: 'Markets',
  stock: 'Stock Detail',
  screener: 'Screener',
  arbitrage: 'Arbitrage',
  ai: 'AI Copilot',
  insights: 'AI/ML Insights',
  alerts: 'Alerts',
  portfolio: 'Portfolio',
  journal: 'Trade Journal',
  options: 'Option Chain',
  commodities: 'Commodities',
  history: 'Date Explorer',
  opening: 'Opening Window',
  flags: 'Flags & Warnings',
  settings: 'Settings',
  admin: 'Admin',
}

const buildExportRows = (screen) => {
  const { prices, selectedSymbol, marketQuotes, watchlistSymbols, feed } = useMarketStore.getState()
  const watchedRows = [...new Set(watchlistSymbols)].map((symbol) => {
    const quote = marketQuotes[symbol]
    const livePrice = resolveDisplayPrice({
      livePrice: prices[symbol],
      quote,
      feed,
    })
    const close = quote?.close
    const change = Number.isFinite(livePrice) && Number.isFinite(close) ? livePrice - close : null
    const percent = Number.isFinite(change) && Number.isFinite(close) && close !== 0 ? (change / close) * 100 : null

    return {
      symbol,
      company: quote?.companyName ?? symbol,
      ltp: Number.isFinite(livePrice) ? livePrice.toFixed(2) : '--',
      change: Number.isFinite(change) ? change.toFixed(2) : '--',
      percent: Number.isFinite(percent) ? `${percent.toFixed(2)}%` : '--',
      exchange: quote?.exchange ?? '--',
      volume: Number.isFinite(quote?.volume) ? String(quote.volume) : '--',
    }
  })

  if (screen === 'dashboard') {
    return watchedRows
  }

  if (screen === 'screener') {
    return watchedRows
  }

  if (screen === 'portfolio') {
    return watchedRows
  }

  if (screen === 'opening') {
    return watchedRows
  }

  if (screen === 'flags') {
    return watchedRows
  }

  const quote = marketQuotes[selectedSymbol] ?? null
  const price = resolveDisplayPrice({
    livePrice: prices[selectedSymbol],
    quote,
    feed,
  })

  return [
    {
      symbol: selectedSymbol,
      company: quote?.companyName ?? selectedSymbol,
      price: Number.isFinite(price) ? price.toFixed(2) : '--',
      open: quote?.open ?? '--',
      high: quote?.high ?? '--',
      low: quote?.low ?? '--',
      close: quote?.close ?? '--',
      volume: quote?.volume ?? '--',
      avgPrice: quote?.averagePrice ?? '--',
    },
  ]
}

const SCREEN_COMPONENTS = {
  dashboard: Dashboard,
  markets: Markets,
  stock: StockDetail,
  screener: Screener,
  arbitrage: Arbitrage,
  ai: AICopilot,
  insights: AIInsights,
  alerts: Alerts,
  portfolio: Portfolio,
  journal: TradeJournal,
  options: Options,
  commodities: Commodities,
  history: History,
  opening: OpeningWindow,
  flags: FlagsWarnings,
  settings: Settings,
  admin: AdminTerminal,
}

function TerminalApp({ session, onLogout }) {
  const [chartCanvas, setChartCanvas] = useState(null)


  const theme = useThemeStore((state) => state.theme)
  const screen = useMarketStore((state) => state.screen)
  const setScreen = useMarketStore((state) => state.setScreen)
  const calendar = useMarketStore((state) => state.calendar)
  const closeCalendar = useMarketStore((state) => state.closeCalendar)
  const selectCalendarDate = useMarketStore((state) => state.selectCalendarDate)
  const exportModalOpen = useMarketStore((state) => state.exportModalOpen)
  const closeExportModal = useMarketStore((state) => state.closeExportModal)
  const addToast = useMarketStore((state) => state.addToast)

  const { exportData, isExporting } = useExport()

  useLivePrice()
  useRestQuotes()

  useEffect(() => {
    document.body.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    let mounted = true

    const unlockAudio = async () => {
      const unlocked = await primeAlertAudio()
      if (!mounted || !unlocked) {
        return
      }

      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }

    window.addEventListener('pointerdown', unlockAudio, { passive: true })
    window.addEventListener('keydown', unlockAudio)

    return () => {
      mounted = false
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const url = new URL(window.location.href)
    const brokerState = url.searchParams.get('broker')
    const brokerMessage = url.searchParams.get('brokerMessage')
    const brokerCode = url.searchParams.get('brokerCode')

    if (!brokerState) return

    // Clean URL immediately
    url.searchParams.delete('broker')
    url.searchParams.delete('brokerMessage')
    url.searchParams.delete('brokerCode')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)

    if (brokerState === 'connected') {
      addToast('Upstox broker connected. Live market feed will start syncing now.', 'h', 5000)
    } else if (brokerState === 'disconnected') {
      addToast('Broker session disconnected.', 'w', 4500)
    } else if (brokerState === 'pending' && brokerCode) {
      // Cookie is present here (same-origin POST) — exchange the code now
      addToast('Completing Upstox authorisation…', 'w', 3000)
      fetch('/api/broker/upstox/exchange', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: brokerCode }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.detail || `HTTP ${res.status}`)
          }
          addToast('Upstox broker connected. Live market feed will start syncing now.', 'h', 5000)
        })
        .catch((err) => {
          addToast(`Upstox token exchange failed: ${err.message}`, 'l', 7000)
        })
    } else {
      addToast(brokerMessage || 'Broker connection failed.', 'l', 6000)
    }
  }, [addToast])

  useEffect(() => {
    if (session?.role !== 'admin' && screen === 'admin') {
      setScreen('dashboard')
    }
  }, [screen, session?.role, setScreen])

  const resolvedScreen = session?.role === 'admin' || screen !== 'admin' ? screen : 'dashboard'
  const pageTitle = useMemo(() => SCREEN_TITLES[resolvedScreen] ?? SCREEN_TITLES.dashboard, [resolvedScreen])
  const ActiveScreen = SCREEN_COMPONENTS[resolvedScreen] ?? Dashboard

  return (
    <div className="app-shell">
      <Toast />

      <Calendar
        open={calendar.open}
        onClose={closeCalendar}
        onPick={(date) => {
          selectCalendarDate(date)
          closeCalendar()
        }}
      />

      <Modal open={exportModalOpen} onClose={closeExportModal} className="exp-modal">
        <div className="em-h">Export / Print</div>

        {EXPORT_OPTIONS.map((option) => (
          <button
            type="button"
            className="em-opt"
            key={option.key}
            disabled={isExporting}
            onClick={() =>
              exportData({
                type: option.key,
                rows: buildExportRows(screen),
                title: `Derton Finance - ${pageTitle}`,
                filePrefix: `derton-${screen}`,
                chartCanvas,
              })
            }
          >
            <span className="em-lbl">
              {isExporting && option.key !== 'print' ? 'Preparing export...' : option.title}
            </span>
            <span className="em-sub">{isExporting ? 'Please wait a moment.' : option.subtitle}</span>
          </button>
        ))}

        <button type="button" className="em-cancel" onClick={closeExportModal} disabled={isExporting}>
          Cancel
        </button>
      </Modal>

      <Topbar onLogout={onLogout} session={session} />

      <div className="terminal-workstation-frame">
        <LeftNav session={session} />

        <div className="terminal-main-column">
          <IndexBar />

          <main id="screens">
            <Suspense
              fallback={
                <LoadingPanel
                  title={`Loading ${pageTitle}`}
                  subtitle="Optimizing the next workspace for desktop view..."
                />
              }
            >
              <ActiveScreen onCaptureCanvas={setChartCanvas} session={session} />
            </Suspense>
          </main>
        </div>
      </div>

      <AssistantFab />
    </div>
  )
}

export default TerminalApp
