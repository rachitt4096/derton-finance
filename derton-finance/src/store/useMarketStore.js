import { create } from 'zustand'
import { DEFAULT_INDICATORS } from '../constants/chart'

const makeToast = (message, type = 'h', duration = 7000) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  message,
  type,
  duration,
})

const formatSelectedDateLabel = (value) => {
  if (!value) {
    return ''
  }

  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const useMarketStore = create((set) => ({
  screen: 'dashboard',
  selectedSymbol: 'RELIANCE',
  watchlistSymbols: [],
  timeframeMain: '1D',
  chartTypeMain: 'area',
  timeframeDetail: '1D',
  chartTypeDetail: 'area',
  chartIndicators: { ...DEFAULT_INDICATORS },
  prices: {},
  marketQuotes: {},
  quoteHealth: {
    status: 'idle',
    error: null,
    lastSuccessAt: null,
  },
  feed: {
    source: 'upstox',
    status: 'connecting',
    latencyMs: null,
    lastSuccessAt: null,
    lastError: null,
    retryInMs: null,
  },
  now: new Date(),
  toasts: [],
  warningCooldown: {},
  activeSymbols: [],
  calendar: {
    open: false,
    context: 'main',
    selectedDateMain: null,
    selectedDateDetail: null,
  },
  exportModalOpen: false,

  setScreen: (screen) => set({ screen }),
  setSelectedSymbol: (selectedSymbol) => set({ selectedSymbol }),
  setWatchlistSymbols: (watchlistSymbols) => set({ watchlistSymbols }),
  setTimeframeMain: (timeframeMain) => set({ timeframeMain }),
  setChartTypeMain: (chartTypeMain) => set({ chartTypeMain }),
  setTimeframeDetail: (timeframeDetail) => set({ timeframeDetail }),
  setChartTypeDetail: (chartTypeDetail) => set({ chartTypeDetail }),
  toggleChartIndicator: (indicatorKey) =>
    set((state) => ({
      chartIndicators: {
        ...state.chartIndicators,
        [indicatorKey]: !state.chartIndicators[indicatorKey],
      },
    })),
  setNow: (now) => set({ now }),
  setPrices: (prices) => set({ prices }),
  setMarketQuotes: (marketQuotes) => set({ marketQuotes }),
  setActiveSymbols: (symbols) =>
    set({
      activeSymbols: [...new Set((symbols ?? []).filter(Boolean).map((symbol) => String(symbol).toUpperCase()))],
    }),
  setQuoteHealth: (patch) =>
    set((state) => ({
      quoteHealth: {
        ...state.quoteHealth,
        ...patch,
      },
    })),
  setFeed: (patch) =>
    set((state) => ({
      feed: {
        ...state.feed,
        ...patch,
      },
    })),

  addToast: (message, type = 'h', duration = 7000) =>
    set((state) => ({
      toasts: [...state.toasts, makeToast(message, type, duration)],
    })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),

  markWarningCooldown: (key, until) =>
    set((state) => ({
      warningCooldown: {
        ...state.warningCooldown,
        [key]: until,
      },
    })),

  openCalendar: (context = 'main') =>
    set((state) => ({
      calendar: {
        ...state.calendar,
        open: true,
        context,
      },
    })),

  closeCalendar: () =>
    set((state) => ({
      calendar: {
        ...state.calendar,
        open: false,
      },
    })),

  selectCalendarDate: (selectedDate) =>
    set((state) => ({
      calendar: {
        ...state.calendar,
        [state.calendar.context === 'detail' ? 'selectedDateDetail' : 'selectedDateMain']: selectedDate,
      },
      toasts: [...state.toasts, makeToast(`Loaded 1D data for ${formatSelectedDateLabel(selectedDate)}.`, 'h', 5000)],
    })),

  resetCalendarDate: (context = 'main') =>
    set((state) => ({
      calendar: {
        ...state.calendar,
        [context === 'detail' ? 'selectedDateDetail' : 'selectedDateMain']: null,
      },
      toasts: [...state.toasts, makeToast('Loaded today chart.', 'h', 3500)],
    })),

  openExportModal: () => set({ exportModalOpen: true }),
  closeExportModal: () => set({ exportModalOpen: false }),
}))

export default useMarketStore
