const NSE_TRADING_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
const PRE_OPEN_START_MINUTES = 9 * 60
const REGULAR_OPEN_MINUTES = 9 * 60 + 15
const REGULAR_CLOSE_MINUTES = 15 * 60 + 30

const getSessionParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')

  return {
    weekday,
    hour,
    minute,
  }
}

export const getNseMarketWindowState = (date = new Date()) => {
  const { weekday, hour, minute } = getSessionParts(date)
  const totalMinutes = hour * 60 + minute
  const isTradingDay = NSE_TRADING_DAYS.has(weekday)

  if (!isTradingDay || totalMinutes >= REGULAR_CLOSE_MINUTES) {
    return { label: 'Closed', badgeLabel: 'CLOSE', className: 'offline' }
  }

  if (totalMinutes < PRE_OPEN_START_MINUTES) {
    return { label: 'Closed', badgeLabel: 'CLOSE', className: 'offline' }
  }

  if (totalMinutes < REGULAR_OPEN_MINUTES) {
    return { label: 'Pre Open', badgeLabel: 'PRE', className: 'connecting' }
  }

  return { label: 'Live', badgeLabel: 'LIVE', className: 'live' }
}

export const isNseRegularSessionOpen = (date = new Date()) => getNseMarketWindowState(date).label === 'Live'

