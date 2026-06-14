const trimTrailingSlash = (value) => value.replace(/\/+$/, '')
const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}

export const BACKEND_URL = trimTrailingSlash((env.VITE_BACKEND_URL ?? '').trim())

// Backend is always available: either via explicit URL or same-origin (empty BACKEND_URL)
export const backendEnabled = true

export const getApiUrl = (path) => {
  if (!BACKEND_URL) {
    return path
  }

  return `${BACKEND_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export const getWsUrl = () => {
  const explicit = (env.VITE_BACKEND_WS_URL ?? '').trim()
  if (explicit) {
    return explicit
  }

  if (!BACKEND_URL && typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }

  if (!BACKEND_URL) {
    return ''
  }

  return `${BACKEND_URL.replace(/^http/i, 'ws')}/ws`
}
