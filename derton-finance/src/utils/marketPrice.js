const STALE_PRICE_WINDOW_MS = 2 * 60 * 1000

const toFiniteNumber = (value) => (Number.isFinite(value) ? Number(value) : null)

export const hasFreshFeed = (feed, now = Date.now()) => {
  const lastSuccessAt = toFiniteNumber(feed?.lastSuccessAt)
  if (!lastSuccessAt) {
    return false
  }

  if (feed?.status !== 'live' && feed?.status !== 'degraded') {
    return false
  }

  return Math.max(0, now - lastSuccessAt) <= STALE_PRICE_WINDOW_MS
}

export const resolveDisplayPrice = ({ livePrice, quote, feed, now = Date.now() }) => {
  const streamPrice = toFiniteNumber(livePrice)
  const sessionClose = toFiniteNumber(quote?.sessionClose)
  const lastPrice = toFiniteNumber(quote?.lastPrice)
  const close = toFiniteNumber(quote?.close)

  if (hasFreshFeed(feed, now)) {
    if (streamPrice && streamPrice > 0) {
      return streamPrice
    }

    if (sessionClose && sessionClose > 0) {
      return sessionClose
    }

    if (lastPrice && lastPrice > 0) {
      return lastPrice
    }
  }

  if (sessionClose && sessionClose > 0) {
    return sessionClose
  }

  if (lastPrice && lastPrice > 0) {
    return lastPrice
  }

  if (close && close > 0) {
    return close
  }

  if (streamPrice && streamPrice > 0) {
    return streamPrice
  }

  return null
}
