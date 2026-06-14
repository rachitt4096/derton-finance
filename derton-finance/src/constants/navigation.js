// placement: 'top'  -> horizontal top navigation (primary analysis workspaces)
//            'side' -> left vertical navigation (operations / data / system)
export const BASE_SCREEN_OPTIONS = [
  { key: 'dashboard', label: 'Dashboard', group: 'Core', placement: 'top' },
  { key: 'markets', label: 'Markets', group: 'Core', placement: 'top' },
  { key: 'stock', label: 'Stock Detail', group: 'Core', placement: 'top' },
  { key: 'history', label: 'History', group: 'Core', placement: 'top' },
  { key: 'screener', label: 'Screener', group: 'Core', placement: 'top' },
  { key: 'options', label: 'Options', group: 'Derivatives', placement: 'top' },
  { key: 'commodities', label: 'Commodities', group: 'Derivatives', placement: 'top' },
  { key: 'arbitrage', label: 'Arbitrage', group: 'Intelligence', placement: 'top' },
  { key: 'ai', label: 'AI Copilot', group: 'Intelligence', placement: 'top' },
  { key: 'insights', label: 'AI/ML', group: 'Intelligence', placement: 'top' },
  { key: 'alerts', label: 'Alerts', group: 'Operations', placement: 'side' },
  { key: 'portfolio', label: 'Portfolio', group: 'Operations', placement: 'side' },
  { key: 'journal', label: 'Journal', group: 'Operations', placement: 'side' },
  { key: 'opening', label: 'Opening Window', group: 'Market Data', placement: 'side' },
  { key: 'flags', label: 'Flags & Warnings', group: 'Market Data', placement: 'side' },
  { key: 'settings', label: 'Settings', group: 'System', placement: 'side' },
]

export const getScreenOptions = (role) => {
  if (role !== 'admin') {
    return BASE_SCREEN_OPTIONS
  }

  return [...BASE_SCREEN_OPTIONS, { key: 'admin', label: 'Admin', group: 'System', placement: 'side' }]
}

export const getTopScreenOptions = (role) =>
  getScreenOptions(role).filter((item) => item.placement === 'top')

export const getSideScreenOptions = (role) =>
  getScreenOptions(role).filter((item) => item.placement === 'side')
