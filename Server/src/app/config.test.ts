import test from 'node:test'
import assert from 'node:assert/strict'
import { parseConfig } from './config.js'

const baseEnv = {
  NODE_ENV: 'production',
  PORT: '4000',
  HOST: '0.0.0.0',
  APP_ORIGIN: 'https://app.example.com',
  POSTGRES_URL: 'postgres://user:pass@localhost:5432/db',
  BROKER_MODE: 'upstox',
  SEED_ADMIN_PASSWORD: 'super-secure-password-2026',
}

test('parseConfig rejects insecure same-site none cookies without secure flag', () => {
  assert.throws(
    () =>
      parseConfig({
        ...baseEnv,
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    /COOKIE_SAME_SITE=none requires COOKIE_SECURE=true/,
  )
})

test('parseConfig rejects default admin password in production', () => {
  assert.throws(
    () =>
      parseConfig({
        ...baseEnv,
        SEED_ADMIN_PASSWORD: 'admin@2026',
      }),
    /SEED_ADMIN_PASSWORD is using the default value/,
  )
})

test('parseConfig rejects localhost app origins in production', () => {
  assert.throws(
    () =>
      parseConfig({
        ...baseEnv,
        APP_ORIGIN: 'http://localhost:5173',
      }),
    /APP_ORIGIN must use HTTPS and cannot point to localhost\/loopback in production/,
  )
})

test('parseConfig requires full Upstox credentials in production', () => {
  assert.throws(
    () =>
      parseConfig({
        ...baseEnv,
        UPSTOX_API_KEY: 'key-only',
      }),
    /missing required Upstox production settings: UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI/,
  )
})
