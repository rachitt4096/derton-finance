export const formatCurrency = (value, digits = 2) =>
  `₹${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`

export const formatCompactCurrency = (value) =>
  `₹${Number(value).toLocaleString('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  })}`

export const formatCrore = (value, digits = 0) =>
  `${Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} Cr`

export const formatCompactCrore = (value) =>
  `${Number(value).toLocaleString('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  })} Cr`

export const formatChange = (value, digits = 2) => {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}${Math.abs(value).toFixed(digits)}`
}

export const formatPercent = (value, digits = 2) => {
  const sign = value >= 0 ? '+' : '-'
  return `${sign}${Math.abs(value).toFixed(digits)}%`
}

export const formatTime = (date) =>
  date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

export const formatShortTime = (date) =>
  date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

export const formatDateShort = (date) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const day = String(date.getDate()).padStart(2, '0')
  const month = months[date.getMonth()]
  const year = String(date.getFullYear()).slice(-2)

  return `${day}-${month}-${year}`
}

export const cn = (...classNames) => classNames.filter(Boolean).join(' ')
