import { useEffect, useState } from 'react'
import { CHART_TYPES, TIMEFRAMES } from '../../constants/chart'

const INDICATOR_OPTIONS = [
  { key: 'rsi', label: 'RSI(14)' },
  { key: 'macd', label: 'MACD(12,26,9)' },
  { key: 'ma20', label: 'MA20' },
  { key: 'ma50', label: 'MA50' },
  { key: 'ma200', label: 'MA200' },
  { key: 'bollinger', label: 'Bollinger' },
  { key: 'vwap', label: 'VWAP' },
]

const prettyType = (type) => {
  if (type === 'candle') {
    return 'Candle'
  }
  return type[0].toUpperCase() + type.slice(1)
}

function ChartControls({
  timeframe,
  chartType,
  indicators,
  timeframes = TIMEFRAMES,
  onToggleIndicator,
  onTimeframe,
  onChartType,
  onExport,
  onOpenCalendar,
  onToday,
  isChartHidden = false,
  onToggleChart,
  isFullscreen = false,
  onToggleFullscreen,
  className = '',
}) {
  const [showIndicators, setShowIndicators] = useState(false)

  useEffect(() => {
    if (!CHART_TYPES.includes(chartType)) {
      onChartType('area')
    }
  }, [chartType, onChartType])

  return (
    <>
      <div className={`chart-ctrl ${className}`.trim()}>
        <div className="chart-ctrl-main">
          <div className="chart-ctrl-group">
            <span className="chart-ctrl-label">Time</span>
            {timeframes.map((value) => (
              <button
                key={value}
                type="button"
                className={`tf-btn ${value === timeframe ? 'on' : ''}`}
                onClick={() => onTimeframe(value)}
                onDoubleClick={() => {
                  if (value === '1D' && onOpenCalendar) {
                    onOpenCalendar()
                  }
                }}
                title={value === '1D' && onOpenCalendar ? 'Open calendar from the Calendar button' : ''}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="chart-ctrl-group">
            <span className="chart-ctrl-label">Chart</span>
            {CHART_TYPES.map((value) => (
              <button
                key={value}
                type="button"
                className={`ct-btn ${value === chartType ? 'on' : ''}`}
                onClick={() => onChartType(value)}
              >
                {prettyType(value)}
              </button>
            ))}
          </div>

          <div className="chart-ctrl-group">
            <button
              type="button"
              className={`ind-btn ${showIndicators ? 'on' : ''}`}
              onClick={() => setShowIndicators((value) => !value)}
            >
              Indicators
            </button>
          </div>
        </div>

        <div className="chart-ctrl-actions">

          <div className="graph-btns">
            {onToday ? (
              <button type="button" className="graph-btn graph-btn-primary" onClick={onToday}>
                Today
              </button>
            ) : null}

            {onOpenCalendar ? (
              <button type="button" className="graph-btn" onClick={onOpenCalendar}>
                Calendar
              </button>
            ) : null}

            {onToggleChart ? (
              <button
                type="button"
                className={`graph-btn ${isChartHidden ? 'active' : ''}`}
                onClick={onToggleChart}
                aria-pressed={isChartHidden}
              >
                {isChartHidden ? 'Show Graph' : 'Hide Graph'}
              </button>
            ) : null}

            {onToggleFullscreen ? (
              <button
                type="button"
                className={`graph-btn ${isFullscreen ? 'active' : ''}`}
                onClick={onToggleFullscreen}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? 'Exit Focus' : 'Focus View'}
              </button>
            ) : null}

            {onExport ? (
              <button type="button" className="exp-btn" onClick={onExport}>
                Export / Print
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {showIndicators ? (
        <div className="ind-panel">
          <span className="ind-panel-label">INDICATORS:</span>
          {INDICATOR_OPTIONS.map((indicator) => (
            <button
              key={indicator.key}
              type="button"
              className={`ind-toggle ${indicators?.[indicator.key] ? 'on' : ''}`}
              onClick={() => onToggleIndicator(indicator.key)}
            >
              {indicator.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}

export default ChartControls
