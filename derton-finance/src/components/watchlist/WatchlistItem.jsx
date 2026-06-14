import { memo } from 'react'
import { cn, formatChange, formatCurrency, formatPercent } from '../../utils/formatters'

const formatCompactCount = (value) =>
  Number.isFinite(value)
    ? Number(value).toLocaleString('en-IN', {
        notation: 'compact',
        maximumFractionDigits: 2,
      })
    : null

const formatCrBadge = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  if (value >= 1000) {
    return `${Math.round(value / 10) * 10}CR+`
  }

  if (value >= 100) {
    return `${Math.round(value)}CR+`
  }

  return `${Math.round(value)}CR`
}

function WatchlistItem({ item, isSelected, onSelect, onRemove }) {
  const quote = item.quote
  const insight = item.insight
  const price = Number.isFinite(item.price) ? item.price : quote?.close ?? null
  const close = quote?.close
  const change = Number.isFinite(price) && Number.isFinite(close) ? price - close : null
  const percent = Number.isFinite(change) && Number.isFinite(close) && close !== 0 ? (change / close) * 100 : null
  const badges = []

  if (Number.isFinite(insight?.profitCr) && insight.profitCr > 0) {
    badges.push({ label: 'PROFIT', tone: 'up' })
  }

  const revenueBadge = formatCrBadge(insight?.revenueCr)
  if (revenueBadge) {
    badges.push({ label: revenueBadge, tone: 'accent' })
  }

  if (Number.isFinite(quote?.volume) && quote.volume > 1000000) {
    badges.push({ label: `VOL ${formatCompactCount(quote.volume)}`, tone: 'gold' })
  }

  if (Number.isFinite(insight?.peRatio) && insight.peRatio >= 30) {
    badges.push({ label: 'HIGH PE', tone: 'warn' })
  }

  if (!badges.length && Number.isFinite(close)) {
    badges.push({ label: `PREV ${formatCurrency(close)}`, tone: 'muted' })
  }

  return (
    <div className={cn('wl-item', isSelected ? 'sel' : '')}>
      <button type="button" className="wl-main" onClick={onSelect}>
        <div className="wi-r1">
          <span className="wl-sym">{item.symbol}</span>
          <span className={cn('wl-ltp mono', change === null || change >= 0 ? 'up' : 'dn')}>
            {Number.isFinite(price) ? formatCurrency(price) : '--'}
          </span>
        </div>

        <div className="wi-r2">
          <span className="wl-company">{quote?.companyName ?? item.symbol}</span>
          <span className={cn('wl-pct mono', change === null || change >= 0 ? 'up' : 'dn')}>
            {Number.isFinite(percent) ? formatPercent(percent) : '--'}
          </span>
        </div>

        <div className="wi-r3">
          {badges.slice(0, 3).map((badge) => (
            <span key={badge.label} className={cn('wl-flag', `wl-flag-${badge.tone}`)}>
              {badge.label}
            </span>
          ))}
          {Number.isFinite(change) ? (
            <span className={cn('wl-change mono', change === null || change >= 0 ? 'up' : 'dn')}>{formatChange(change)}</span>
          ) : null}
        </div>
      </button>

      {onRemove ? (
        <button type="button" className="wl-remove" onClick={() => onRemove(item.symbol)} aria-label={`Remove ${item.symbol}`}>
          ×
        </button>
      ) : null}
    </div>
  )
}

export default memo(WatchlistItem)
