const COLLECTION_KEYS = ['prices', 'data', 'result', 'results', 'quotes', 'items', 'stocks', 'payload']
const SYMBOL_KEYS = ['symbol', 'sym', 'ticker', 'instrument', 'code']
const PRICE_KEYS = ['price', 'ltp', 'lastPrice', 'last', 'close', 'value', 'p']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const toNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim()
    if (!cleaned) {
      return null
    }
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const normalizeSymbol = (value) => {
  if (typeof value !== 'string') {
    return null
  }

  const symbol = value.trim().toUpperCase()
  return symbol || null
}

const findValueByKeys = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key]
    }
  }
  return null
}

const pushEntry = (target, symbolValue, priceValue) => {
  const symbol = normalizeSymbol(symbolValue)
  const price = toNumber(priceValue)

  if (!symbol || price === null || price <= 0) {
    return
  }

  target[symbol] = price
}

const parseArray = (rows, target) => {
  rows.forEach((row) => {
    if (!isObject(row)) {
      return
    }

    const symbol = findValueByKeys(row, SYMBOL_KEYS)
    const price = findValueByKeys(row, PRICE_KEYS)
    pushEntry(target, symbol, price)
  })
}

const parseMap = (mapLike, target) => {
  Object.entries(mapLike).forEach(([key, value]) => {
    if (typeof value === 'number' || typeof value === 'string') {
      pushEntry(target, key, value)
      return
    }

    if (!isObject(value)) {
      return
    }

    const symbol = findValueByKeys(value, SYMBOL_KEYS) ?? key
    const price = findValueByKeys(value, PRICE_KEYS)
    pushEntry(target, symbol, price)
  })
}

export const normalizePricePayload = (payload) => {
  const result = {}
  const sources = [payload]

  if (isObject(payload)) {
    COLLECTION_KEYS.forEach((key) => {
      if (payload[key] !== undefined) {
        sources.push(payload[key])
      }
    })
  }

  sources.forEach((source) => {
    if (Array.isArray(source)) {
      parseArray(source, result)
      return
    }

    if (!isObject(source)) {
      return
    }

    const symbol = findValueByKeys(source, SYMBOL_KEYS)
    const price = findValueByKeys(source, PRICE_KEYS)
    if (symbol !== null && price !== null) {
      pushEntry(result, symbol, price)
      return
    }

    parseMap(source, result)
  })

  return result
}

