const rollingWindow = (values, period) => {
  if (values.length < period) {
    return []
  }

  let sum = 0
  const output = []

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index]

    if (index >= period) {
      sum -= values[index - period]
    }

    if (index >= period - 1) {
      output.push(sum / period)
    } else {
      output.push(null)
    }
  }

  return output
}

const exponentialMovingAverage = (values, period) => {
  if (!values.length) {
    return []
  }

  const smoothing = 2 / (period + 1)
  const output = Array(values.length).fill(null)

  let first = 0
  for (let index = 0; index < period && index < values.length; index += 1) {
    first += values[index]
  }

  if (values.length < period) {
    return output
  }

  output[period - 1] = first / period

  for (let index = period; index < values.length; index += 1) {
    output[index] = values[index] * smoothing + output[index - 1] * (1 - smoothing)
  }

  return output
}

export const calculateSMA = (candles, period) => {
  const closes = candles.map((candle) => candle.c)
  const values = rollingWindow(closes, period)

  return candles
    .map((candle, index) => ({
      time: candle.t,
      value: values[index],
    }))
    .filter((point) => Number.isFinite(point.value))
}

export const calculateBollingerBands = (candles, period = 20, multiplier = 2) => {
  if (candles.length < period) {
    return { upper: [], middle: [], lower: [] }
  }

  const closes = candles.map((candle) => candle.c)
  const middle = rollingWindow(closes, period)

  const upper = []
  const lower = []

  for (let index = 0; index < closes.length; index += 1) {
    const mean = middle[index]
    if (!Number.isFinite(mean)) {
      upper.push(null)
      lower.push(null)
      continue
    }

    let variance = 0
    for (let lookback = index - period + 1; lookback <= index; lookback += 1) {
      variance += (closes[lookback] - mean) ** 2
    }

    const stdDev = Math.sqrt(variance / period)
    upper.push(mean + multiplier * stdDev)
    lower.push(mean - multiplier * stdDev)
  }

  return {
    upper: candles
      .map((candle, index) => ({ time: candle.t, value: upper[index] }))
      .filter((point) => Number.isFinite(point.value)),
    middle: candles
      .map((candle, index) => ({ time: candle.t, value: middle[index] }))
      .filter((point) => Number.isFinite(point.value)),
    lower: candles
      .map((candle, index) => ({ time: candle.t, value: lower[index] }))
      .filter((point) => Number.isFinite(point.value)),
  }
}

export const calculateVWAP = (candles) => {
  let cumulativePV = 0
  let cumulativeVolume = 0

  return candles.map((candle) => {
    const typicalPrice = (candle.h + candle.l + candle.c) / 3
    cumulativePV += typicalPrice * candle.v
    cumulativeVolume += candle.v

    return {
      time: candle.t,
      value: cumulativeVolume ? cumulativePV / cumulativeVolume : typicalPrice,
    }
  })
}

export const calculateRSI = (candles, period = 14) => {
  if (candles.length <= period) {
    return []
  }

  const closes = candles.map((candle) => candle.c)
  const gains = []
  const losses = []

  for (let index = 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1]
    gains.push(Math.max(delta, 0))
    losses.push(Math.max(-delta, 0))
  }

  let averageGain = gains.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  let averageLoss = losses.slice(0, period).reduce((sum, value) => sum + value, 0) / period

  const result = []

  for (let index = period; index < gains.length; index += 1) {
    averageGain = (averageGain * (period - 1) + gains[index]) / period
    averageLoss = (averageLoss * (period - 1) + losses[index]) / period

    const relativeStrength = averageLoss === 0 ? 100 : averageGain / averageLoss
    const rsi = 100 - 100 / (1 + relativeStrength)

    result.push({
      time: candles[index + 1].t,
      value: rsi,
    })
  }

  return result
}

export const calculateMACD = (candles, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) => {
  if (candles.length <= longPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] }
  }

  const closes = candles.map((candle) => candle.c)
  const shortEMA = exponentialMovingAverage(closes, shortPeriod)
  const longEMA = exponentialMovingAverage(closes, longPeriod)

  const macdValues = closes.map((_, index) => {
    if (!Number.isFinite(shortEMA[index]) || !Number.isFinite(longEMA[index])) {
      return null
    }
    return shortEMA[index] - longEMA[index]
  })

  const compactMacd = macdValues.filter((value) => Number.isFinite(value))
  const signalCompact = exponentialMovingAverage(compactMacd, signalPeriod)

  const signalValues = Array(macdValues.length).fill(null)
  let signalIndex = 0
  for (let index = 0; index < macdValues.length; index += 1) {
    if (Number.isFinite(macdValues[index])) {
      signalValues[index] = signalCompact[signalIndex]
      signalIndex += 1
    }
  }

  const macd = []
  const signal = []
  const histogram = []

  for (let index = 0; index < candles.length; index += 1) {
    const macdValue = macdValues[index]
    const signalValue = signalValues[index]

    if (!Number.isFinite(macdValue)) {
      continue
    }

    const time = candles[index].t

    macd.push({ time, value: macdValue })

    if (Number.isFinite(signalValue)) {
      signal.push({ time, value: signalValue })
      histogram.push({
        time,
        value: macdValue - signalValue,
      })
    }
  }

  return { macd, signal, histogram }
}
