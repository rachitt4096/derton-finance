import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only: proxy API + WebSocket to a live backend so `npm run dev` can log in
// and stream real data while staying same-origin. Override the target with
// DEV_PROXY_TARGET; defaults to production.
//
// The backend issues the session cookie with `Secure` (it normally runs over
// HTTPS). Browsers refuse to store a `Secure` cookie on http://localhost, so we
// strip that flag (and the prod Domain) from proxied Set-Cookie headers — only
// for the dev server. This block has no effect on `vite build`.
const proxyTarget = process.env.DEV_PROXY_TARGET || 'http://localhost:4000'

const stripSecureCookie = (proxy) => {
  proxy.on('proxyRes', (proxyRes) => {
    const setCookie = proxyRes.headers['set-cookie']
    if (Array.isArray(setCookie)) {
      proxyRes.headers['set-cookie'] = setCookie.map((c) =>
        c
          .replace(/;\s*Secure/gi, '')
          .replace(/;\s*Domain=[^;]+/gi, ''),
      )
    }
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
        configure: stripSecureCookie,
      },
      '/ws': {
        target: proxyTarget,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
