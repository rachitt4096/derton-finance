import type { BrokerStatusSnapshot } from '../lib/contracts.js'

const NSE_TRADING_DAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
const PRE_OPEN_START_MINUTES = 9 * 60
const SESSION_OPEN_MINUTES = 9 * 60 + 15
const SESSION_CLOSE_MINUTES = 15 * 60 + 30

const getSessionParts = (now: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)

  return {
    weekday,
    hour,
    minute,
  }
}

export const isNseMarketDataWindowOpen = (now = new Date()) => {
  const { weekday, hour, minute } = getSessionParts(now)

  if (!NSE_TRADING_DAYS.has(weekday) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false
  }

  const totalMinutes = hour * 60 + minute
  return totalMinutes >= PRE_OPEN_START_MINUTES && totalMinutes < SESSION_CLOSE_MINUTES
}

export const isNseTradingSessionOpen = (now = new Date()) => {
  const { weekday, hour, minute } = getSessionParts(now)

  if (!NSE_TRADING_DAYS.has(weekday) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false
  }

  const totalMinutes = hour * 60 + minute
  return totalMinutes >= SESSION_OPEN_MINUTES && totalMinutes < SESSION_CLOSE_MINUTES
}

export const normalizeBrokerStatusForSession = (
  status: BrokerStatusSnapshot,
  now = new Date(),
): BrokerStatusSnapshot => {
  if (status.status !== 'connecting' || isNseMarketDataWindowOpen(now)) {
    return status
  }

  return {
    ...status,
    status: 'idle',
    retryInMs: null,
  }
}
