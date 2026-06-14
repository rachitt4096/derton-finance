import { useEffect, useMemo, useRef, useState } from 'react'
import {
  calculateBollingerBands,
  calculateSMA,
  calculateVWAP,
} from '../../utils/chartHelpers'
import { formatCurrency, formatPercent, formatShortTime } from '../../utils/formatters'
import useThemeStore from '../../store/useThemeStore'

const cssColor = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
  getComputedStyle(document.body).getPropertyValue(name).trim() ||
  fallback

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const formatAxisPrice = (value) =>
  `₹${Number(value).toLocaleString('en-IN', {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 1 : 2,
  })}`

const volumeLabel = (value) => {
  if (!Number.isFinite(value)) return '--'
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)}L`
  return value.toLocaleString('en-IN')
}

const getRange = (candles, overlays, currentPrice) => {
  const values = []
  candles.forEach((candle) => {
    values.push(candle.h, candle.l, candle.c)
  })
  overlays.forEach((series) => {
    series.forEach((point) => values.push(point.value))
  })
  if (Number.isFinite(currentPrice)) values.push(currentPrice)

  const finite = values.filter(Number.isFinite)
  if (!finite.length) return { min: 0, max: 1 }

  let min = Math.min(...finite)
  let max = Math.max(...finite)
  if (min === max) {
    min -= 1
    max += 1
  }

  const pad = (max - min) * 0.12
  return { min: min - pad, max: max + pad }
}

const makePointLookup = (candles) =>
  new Map(candles.map((candle, index) => [candle.t.getTime(), index]))

function MainChart({
  id,
  symbol,
  candles = [],
  chartType = 'area',
  indicators = {},
  currentPrice,
  onCanvasReady,
}) {
  const theme = useThemeStore((state) => state.theme)
  const wrapperRef = useRef(null)
  const canvasRef = useRef(null)
  const [hoverIndex, setHoverIndex] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  const sortedCandles = useMemo(
    () =>
      [...candles]
        .filter(
          (candle) =>
            candle?.t instanceof Date &&
            Number.isFinite(candle.t.getTime()) &&
            Number.isFinite(candle.o) &&
            Number.isFinite(candle.h) &&
            Number.isFinite(candle.l) &&
            Number.isFinite(candle.c),
        )
        .sort((left, right) => left.t.getTime() - right.t.getTime()),
    [candles],
  )

  const overlays = useMemo(() => {
    const output = []
    if (indicators?.ma20) output.push({ key: 'ma20', color: cssColor('--gold', '#ffc04f'), points: calculateSMA(sortedCandles, 20) })
    if (indicators?.ma50) output.push({ key: 'ma50', color: cssColor('--green', '#2be391'), points: calculateSMA(sortedCandles, 50) })
    if (indicators?.ma200) output.push({ key: 'ma200', color: cssColor('--accent', '#70d7ff'), points: calculateSMA(sortedCandles, 200) })
    if (indicators?.vwap) output.push({ key: 'vwap', color: cssColor('--orange', '#ff9f43'), points: calculateVWAP(sortedCandles) })
    if (indicators?.bollinger) {
      const bands = calculateBollingerBands(sortedCandles)
      output.push({ key: 'bbUpper', color: cssColor('--text3', '#7f8da8'), points: bands.upper, dashed: true })
      output.push({ key: 'bbMiddle', color: cssColor('--text2', '#9aa9c2'), points: bands.middle, dashed: true })
      output.push({ key: 'bbLower', color: cssColor('--text3', '#7f8da8'), points: bands.lower, dashed: true })
    }
    return output
  }, [indicators, sortedCandles, theme])

  const hoverCandle = hoverIndex === null ? null : sortedCandles[hoverIndex] ?? null
  const legendPoint = hoverCandle ?? sortedCandles[sortedCandles.length - 1] ?? null
  const legendChange = legendPoint ? legendPoint.c - legendPoint.o : 0
  const legendChangePct = legendPoint?.o ? (legendChange / legendPoint.o) * 100 : 0

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return undefined

    const sync = () => {
      const rect = wrapper.getBoundingClientRect()
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      })
    }

    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(wrapper)
    window.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.width || !size.height) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(size.width * dpr)
    canvas.height = Math.floor(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const colors = {
      bg: cssColor('--bg0', '#05070c'),
      panel: cssColor('--panel', '#0b1018'),
      grid: cssColor('--border', 'rgba(124,148,184,.16)'),
      gridSoft: cssColor('--border2', 'rgba(124,148,184,.1)'),
      text: cssColor('--text2', '#9aa9c2'),
      textStrong: cssColor('--text', '#edf4ff'),
      up: cssColor('--green', '#2be391'),
      down: cssColor('--red', '#ff718d'),
      accent: cssColor('--accent', '#70d7ff'),
    }

    ctx.clearRect(0, 0, size.width, size.height)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, size.width, size.height)

    const pad = { left: 14, right: 72, top: 22, bottom: 34 }
    const volumeHeight = sortedCandles.length ? 44 : 0
    const plot = {
      x: pad.left,
      y: pad.top,
      w: Math.max(20, size.width - pad.left - pad.right),
      h: Math.max(40, size.height - pad.top - pad.bottom - volumeHeight),
    }
    const volumeTop = plot.y + plot.h + 8
    const pointLookup = makePointLookup(sortedCandles)
    const overlayPoints = overlays.flatMap((series) => series.points)
    const range = getRange(sortedCandles, overlays.map((series) => series.points), Number(currentPrice))
    const maxVolume = Math.max(...sortedCandles.map((candle) => candle.v || 0), 1)

    const xForIndex = (index) =>
      sortedCandles.length <= 1 ? plot.x + plot.w / 2 : plot.x + (index / (sortedCandles.length - 1)) * plot.w
    const yForPrice = (price) => plot.y + ((range.max - price) / (range.max - range.min)) * plot.h

    ctx.strokeStyle = colors.gridSoft
    ctx.lineWidth = 1
    ctx.font = '10px JetBrains Mono, monospace'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = colors.text

    for (let i = 0; i <= 4; i += 1) {
      const y = plot.y + (plot.h / 4) * i
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
      const value = range.max - ((range.max - range.min) / 4) * i
      ctx.fillText(formatAxisPrice(value), plot.x + plot.w + 10, y)
    }

    for (let i = 0; i <= 4; i += 1) {
      const x = plot.x + (plot.w / 4) * i
      ctx.beginPath()
      ctx.moveTo(x, plot.y)
      ctx.lineTo(x, plot.y + plot.h)
      ctx.stroke()
      const candle = sortedCandles[Math.round(((sortedCandles.length - 1) / 4) * i)]
      if (candle) {
        ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'
        ctx.fillText(formatShortTime(candle.t), x, size.height - 16)
      }
    }
    ctx.textAlign = 'left'

    if (!sortedCandles.length) {
      onCanvasReady?.(canvas)
      return
    }

    const candleGap = sortedCandles.length <= 1 ? plot.w : plot.w / Math.max(sortedCandles.length - 1, 1)
    const candleWidth = clamp(candleGap * 0.58, 2, 9)

    if (chartType === 'area') {
      const gradient = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h)
      gradient.addColorStop(0, 'rgba(112, 215, 255, 0.34)')
      gradient.addColorStop(1, 'rgba(112, 215, 255, 0.03)')

      ctx.beginPath()
      sortedCandles.forEach((candle, index) => {
        const x = xForIndex(index)
        const y = yForPrice(candle.c)
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.lineTo(xForIndex(sortedCandles.length - 1), plot.y + plot.h)
      ctx.lineTo(xForIndex(0), plot.y + plot.h)
      ctx.closePath()
      ctx.fillStyle = gradient
      ctx.fill()
    }

    if (chartType === 'candle') {
      sortedCandles.forEach((candle, index) => {
        const x = xForIndex(index)
        const isUp = candle.c >= candle.o
        const color = isUp ? colors.up : colors.down
        const openY = yForPrice(candle.o)
        const closeY = yForPrice(candle.c)
        const highY = yForPrice(candle.h)
        const lowY = yForPrice(candle.l)
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(x, highY)
        ctx.lineTo(x, lowY)
        ctx.stroke()
        ctx.fillRect(x - candleWidth / 2, Math.min(openY, closeY), candleWidth, Math.max(1, Math.abs(closeY - openY)))
      })
    } else {
      ctx.beginPath()
      sortedCandles.forEach((candle, index) => {
        const x = xForIndex(index)
        const y = yForPrice(candle.c)
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.strokeStyle = colors.accent
      ctx.lineWidth = 2
      ctx.stroke()
    }

    overlays.forEach((series) => {
      if (!series.points.length) return
      ctx.save()
      ctx.beginPath()
      let started = false
      series.points.forEach((point) => {
        const index = pointLookup.get(point.time.getTime())
        if (!Number.isFinite(index)) return
        const x = xForIndex(index)
        const y = yForPrice(point.value)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else {
          ctx.lineTo(x, y)
        }
      })
      if (series.dashed) ctx.setLineDash([5, 5])
      ctx.strokeStyle = series.color
      ctx.lineWidth = 1.35
      ctx.stroke()
      ctx.restore()
    })

    sortedCandles.forEach((candle, index) => {
      const x = xForIndex(index)
      const h = ((candle.v || 0) / maxVolume) * (volumeHeight - 12)
      ctx.fillStyle = candle.c >= candle.o ? 'rgba(43, 227, 145, .28)' : 'rgba(255, 113, 141, .28)'
      ctx.fillRect(x - candleWidth / 2, volumeTop + volumeHeight - h, candleWidth, h)
    })

    const latest = sortedCandles[sortedCandles.length - 1]
    const linePrice = Number.isFinite(currentPrice) ? Number(currentPrice) : latest.c
    if (Number.isFinite(linePrice)) {
      const y = yForPrice(linePrice)
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = linePrice >= latest.o ? colors.up : colors.down
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = linePrice >= latest.o ? colors.up : colors.down
      ctx.fillRect(plot.x + plot.w + 4, y - 9, 62, 18)
      ctx.fillStyle = '#05100c'
      ctx.font = '10px JetBrains Mono, monospace'
      ctx.fillText(formatAxisPrice(linePrice), plot.x + plot.w + 8, y)
    }

    if (hoverIndex !== null && sortedCandles[hoverIndex]) {
      const x = xForIndex(hoverIndex)
      ctx.strokeStyle = colors.grid
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(x, plot.y)
      ctx.lineTo(x, plot.y + plot.h + volumeHeight)
      ctx.stroke()
      ctx.setLineDash([])
    }

    onCanvasReady?.(canvas)
  }, [chartType, currentPrice, hoverIndex, onCanvasReady, overlays, size, sortedCandles, theme])

  const handlePointerMove = (event) => {
    if (!wrapperRef.current || !sortedCandles.length) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    const plotLeft = 14
    const plotWidth = Math.max(20, rect.width - 86)
    const index = clamp(Math.round(((x - plotLeft) / plotWidth) * (sortedCandles.length - 1)), 0, sortedCandles.length - 1)
    setHoverIndex(index)
    setTooltipPosition({
      x: x + 16 > rect.width - 190 ? x - 190 : x + 16,
      y: event.clientY - rect.top - 26,
    })
  }

  return (
    <div
      className="chart-wrap native-chart-wrap"
      ref={wrapperRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        setHoverIndex(null)
        setTooltipPosition(null)
      }}
    >
      {legendPoint ? (
        <div className="chart-legend">
          <div className="chart-legend-head">
            <span className="chart-legend-sym">{symbol}</span>
            <span className="chart-legend-time">{formatShortTime(legendPoint.t)}</span>
            <span className={`chart-legend-change ${legendChange >= 0 ? 'up' : 'dn'}`}>
              {`${legendChange >= 0 ? '+' : '-'}${formatCurrency(Math.abs(legendChange))} ${formatPercent(
                legendChangePct,
              )}`}
            </span>
          </div>

          <div className="chart-legend-grid">
            <div className="chart-legend-item"><span>O</span><strong>{formatCurrency(legendPoint.o)}</strong></div>
            <div className="chart-legend-item"><span>H</span><strong className="up">{formatCurrency(legendPoint.h)}</strong></div>
            <div className="chart-legend-item"><span>L</span><strong className="dn">{formatCurrency(legendPoint.l)}</strong></div>
            <div className="chart-legend-item"><span>C</span><strong>{formatCurrency(legendPoint.c)}</strong></div>
            <div className="chart-legend-item"><span>Vol</span><strong>{volumeLabel(legendPoint.v)}</strong></div>
          </div>
        </div>
      ) : null}

      <canvas id={id} className="native-chart-canvas" ref={canvasRef} />

      {tooltipPosition && hoverCandle ? (
        <div
          className="native-chart-tooltip"
          style={{ transform: `translate(${tooltipPosition.x}px, ${tooltipPosition.y}px)` }}
        >
          <strong>{symbol}</strong>
          <span>{formatShortTime(hoverCandle.t)}</span>
          <span>O {formatCurrency(hoverCandle.o)}</span>
          <span>H {formatCurrency(hoverCandle.h)}</span>
          <span>L {formatCurrency(hoverCandle.l)}</span>
          <span>C {formatCurrency(hoverCandle.c)}</span>
        </div>
      ) : null}

      {!sortedCandles.length ? (
        <div className="chart-empty-state">
          <div className="chart-empty-title">No chart data</div>
          <div className="chart-empty-copy">Waiting for historical candles for this session.</div>
        </div>
      ) : null}
    </div>
  )
}

export default MainChart
