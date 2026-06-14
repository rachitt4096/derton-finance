import type { AppConfig } from '../app/config.js'
import { BrokerCredentialStore } from './brokerCredentialStore.js'

type TokenExchangeResponse = {
  access_token?: string
  email?: string
  user_id?: string
  user_name?: string
  [key: string]: unknown
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const computeDefaultExpiry = (issuedAt = Date.now()) => {
  const istNow = issuedAt + IST_OFFSET_MS
  const istDate = new Date(istNow)
  let expiryIstMs = Date.UTC(istDate.getUTCFullYear(), istDate.getUTCMonth(), istDate.getUTCDate(), 3, 30, 0, 0)

  if (istNow >= expiryIstMs) {
    expiryIstMs = Date.UTC(
      istDate.getUTCFullYear(),
      istDate.getUTCMonth(),
      istDate.getUTCDate() + 1,
      3,
      30,
      0,
      0,
    )
  }

  return new Date(expiryIstMs - IST_OFFSET_MS)
}

export class UpstoxAuthService {
  constructor(
    private readonly config: AppConfig,
    private readonly credentialStore: BrokerCredentialStore,
  ) {}

  isConfigured() {
    return Boolean(
      this.config.UPSTOX_API_KEY.trim() &&
        this.config.UPSTOX_API_SECRET.trim() &&
        this.config.UPSTOX_REDIRECT_URI.trim(),
    )
  }

  getAuthorizationUrl(state?: string) {
    if (!this.isConfigured()) {
      throw new Error('Upstox OAuth is not configured. Set UPSTOX_API_KEY, UPSTOX_API_SECRET, and UPSTOX_REDIRECT_URI.')
    }

    const url = new URL(this.config.UPSTOX_AUTH_URL)
    url.searchParams.set('client_id', this.config.UPSTOX_API_KEY.trim())
    url.searchParams.set('redirect_uri', this.config.UPSTOX_REDIRECT_URI.trim())

    if (state) {
      url.searchParams.set('state', state)
    }

    return url.toString()
  }

  async exchangeCode(code: string) {
    if (!this.isConfigured()) {
      throw new Error('Upstox OAuth is not configured.')
    }

    const payload = new URLSearchParams({
      code,
      client_id: this.config.UPSTOX_API_KEY.trim(),
      client_secret: this.config.UPSTOX_API_SECRET.trim(),
      redirect_uri: this.config.UPSTOX_REDIRECT_URI.trim(),
      grant_type: 'authorization_code',
    })

    const response = await fetch(this.config.UPSTOX_TOKEN_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    })

    const rawText = await response.text()
    let parsed: TokenExchangeResponse | { errors?: Array<{ message?: string }> } | null = null

    try {
      parsed = rawText ? (JSON.parse(rawText) as TokenExchangeResponse) : null
    } catch {
      parsed = null
    }

    if (!response.ok) {
      const firstError = Array.isArray((parsed as { errors?: Array<{ message?: string }> } | null)?.errors)
        ? (parsed as { errors?: Array<{ message?: string }> }).errors?.[0]?.message
        : null

      throw new Error(firstError || `Upstox token exchange failed with HTTP ${response.status}`)
    }

    const accessToken = parsed?.access_token?.trim()
    if (!accessToken) {
      throw new Error('Upstox token exchange did not return an access token')
    }

    const expiresAt = computeDefaultExpiry()
    await this.credentialStore.set('upstox', accessToken, expiresAt, {
      email: parsed?.email ?? null,
      userId: parsed?.user_id ?? null,
      userName: parsed?.user_name ?? null,
      issuedAt: new Date().toISOString(),
      raw: parsed ?? {},
    })

    return {
      accessToken,
      expiresAt,
      profile: {
        email: parsed?.email ?? null,
        userId: parsed?.user_id ?? null,
        userName: parsed?.user_name ?? null,
      },
    }
  }

  async disconnect() {
    await this.credentialStore.clear('upstox')
  }

  async getStoredCredential() {
    return this.credentialStore.get('upstox')
  }
}
