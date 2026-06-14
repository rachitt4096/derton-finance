import type { Server as HttpServer, IncomingMessage } from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AuthService } from '../../auth/authService.js'
import type { AppConfig } from '../../app/config.js'
import { clientSocketMessageSchema, type BrokerStatusSnapshot, type ServerSocketMessage } from '../../lib/contracts.js'
import type { WatchlistService } from '../../watchlists/watchlistService.js'
import type { MarketRuntime } from '../../market/marketRuntime.js'

const readCookie = (request: IncomingMessage, name: string) => {
  const header = request.headers.cookie ?? ''
  const chunks = header.split(';').map((part) => part.trim())
  for (const chunk of chunks) {
    const [key, ...rest] = chunk.split('=')
    if (key === name) {
      return decodeURIComponent(rest.join('='))
    }
  }
  return null
}

type SocketClient = {
  id: string
  socket: WebSocket
  userId: string | null
}

export class FrontendSocketServer {
  private readonly wss: WebSocketServer
  private readonly clients = new Map<string, SocketClient>()
  private broadcastInterval: NodeJS.Timeout | null = null

  constructor(
    server: HttpServer,
    private readonly config: AppConfig,
    private readonly authService: AuthService,
    private readonly watchlistService: WatchlistService,
    private readonly marketRuntime: MarketRuntime,
  ) {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (request, socket, head) => {
      let pathname = ''
      try {
        pathname = request.url ? new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname : ''
      } catch {
        socket.destroy()
        return
      }

      if (pathname !== '/ws') {
        socket.destroy()
        return
      }

      this.wss.handleUpgrade(request, socket, head, (clientSocket) => {
        this.wss.emit('connection', clientSocket, request)
      })
    })

    this.wss.on('connection', (socket, request) => {
      const id = crypto.randomUUID()
      const client: SocketClient = { id, socket, userId: null }
      this.clients.set(id, client)

      socket.on('message', (raw) => {
        void this.handleMessage(client, request, raw.toString()).catch((error) => {
          this.logSocketError('failed to process socket message', error)
          this.send(client.socket, { type: 'error', message: 'Socket processing failed' })
        })
      })

      socket.on('close', () => {
        this.clients.delete(id)
        void Promise.allSettled([
          this.marketRuntime.clearConsumerSymbols(`focus:${id}`),
          this.marketRuntime.clearConsumerSymbols(`screen:${id}`),
        ]).catch((error) => {
          this.logSocketError('failed to clear socket subscriptions', error)
        })
      })
    })

    this.marketRuntime.onStatusChange((status) => {
      this.broadcast({
        type: 'feed.status',
        ...status,
      })
    })
  }

  start() {
    this.broadcastInterval = setInterval(() => {
      this.broadcast({
        type: 'market.snapshot',
        ...this.marketRuntime.getSnapshot(),
      })
    }, this.config.MARKET_SNAPSHOT_MS)
  }

  stop() {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval)
      this.broadcastInterval = null
    }
    for (const client of this.clients.values()) {
      client.socket.close()
    }
    this.wss.close()
  }

  private async handleMessage(client: SocketClient, request: IncomingMessage, raw: string) {
    let payload: unknown

    try {
      payload = JSON.parse(raw)
    } catch {
      this.send(client.socket, { type: 'error', message: 'Invalid JSON payload' })
      return
    }

    const message = clientSocketMessageSchema.safeParse(payload)
    if (!message.success) {
      this.send(client.socket, { type: 'error', message: 'Unsupported WebSocket message' })
      return
    }

    const token = readCookie(request, this.config.COOKIE_NAME)
    const user = token ? await this.authService.getSessionUser(token) : null

    if (message.data.type === 'session.init') {
      if (!user) {
        this.send(client.socket, { type: 'error', message: 'Unauthorized socket session' })
        client.socket.close()
        return
      }

      client.userId = user.id
      const watchlist = await this.watchlistService.getDefaultWatchlist(user.id)
      await this.marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, watchlist)
      this.send(client.socket, {
        type: 'session.ready',
        user,
        watchlist,
        feedStatus: this.marketRuntime.getStatus(),
      })
      this.send(client.socket, {
        type: 'market.snapshot',
        ...this.marketRuntime.getSnapshot(),
      })
      return
    }

    if (!user) {
      this.send(client.socket, { type: 'error', message: 'Unauthorized socket session' })
      return
    }

    if (message.data.type === 'watchlist.set') {
      const symbols = await this.watchlistService.setDefaultWatchlist(user.id, message.data.symbols)
      await this.marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols)
      this.send(client.socket, {
        type: 'session.ready',
        user,
        watchlist: symbols,
        feedStatus: this.marketRuntime.getStatus(),
      })
      return
    }

    if (message.data.type === 'focus.set') {
      await this.marketRuntime.setConsumerSymbols(`focus:${client.id}`, [message.data.symbol.toUpperCase()])
      return
    }

    if (message.data.type === 'symbols.set') {
      await this.marketRuntime.setConsumerSymbols(
        `screen:${client.id}`,
        message.data.symbols.map((symbol) => symbol.toUpperCase()),
      )
    }
  }

  private broadcast(message: ServerSocketMessage) {
    for (const client of this.clients.values()) {
      if (!client.userId) {
        continue
      }
      this.send(client.socket, message)
    }
  }

  private send(socket: WebSocket, message: ServerSocketMessage | { type: 'error'; message: string }) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }

  private logSocketError(message: string, error: unknown) {
    const err = error instanceof Error ? error : new Error('Unknown websocket error')
    console.error(`[frontend-socket] ${message}`, err)
  }
}
