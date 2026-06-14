import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { clientSocketMessageSchema } from '../../lib/contracts.js';
const readCookie = (request, name) => {
    const header = request.headers.cookie ?? '';
    const chunks = header.split(';').map((part) => part.trim());
    for (const chunk of chunks) {
        const [key, ...rest] = chunk.split('=');
        if (key === name) {
            return decodeURIComponent(rest.join('='));
        }
    }
    return null;
};
export class FrontendSocketServer {
    config;
    authService;
    watchlistService;
    marketRuntime;
    wss;
    clients = new Map();
    broadcastInterval = null;
    constructor(server, config, authService, watchlistService, marketRuntime) {
        this.config = config;
        this.authService = authService;
        this.watchlistService = watchlistService;
        this.marketRuntime = marketRuntime;
        this.wss = new WebSocketServer({ noServer: true });
        server.on('upgrade', (request, socket, head) => {
            const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
            if (pathname !== '/ws') {
                socket.destroy();
                return;
            }
            this.wss.handleUpgrade(request, socket, head, (clientSocket) => {
                this.wss.emit('connection', clientSocket, request);
            });
        });
        this.wss.on('connection', (socket, request) => {
            const id = crypto.randomUUID();
            const client = { id, socket, userId: null };
            this.clients.set(id, client);
            socket.on('message', (raw) => {
                void this.handleMessage(client, request, raw.toString());
            });
            socket.on('close', () => {
                this.clients.delete(id);
                void this.marketRuntime.clearConsumerSymbols(`focus:${id}`);
            });
        });
        this.marketRuntime.onStatusChange((status) => {
            this.broadcast({
                type: 'feed.status',
                ...status,
            });
        });
    }
    start() {
        this.broadcastInterval = setInterval(() => {
            this.broadcast({
                type: 'market.snapshot',
                ...this.marketRuntime.getSnapshot(),
            });
        }, this.config.MARKET_SNAPSHOT_MS);
    }
    stop() {
        if (this.broadcastInterval) {
            clearInterval(this.broadcastInterval);
            this.broadcastInterval = null;
        }
        for (const client of this.clients.values()) {
            client.socket.close();
        }
        this.wss.close();
    }
    async handleMessage(client, request, raw) {
        let payload;
        try {
            payload = JSON.parse(raw);
        }
        catch {
            this.send(client.socket, { type: 'error', message: 'Invalid JSON payload' });
            return;
        }
        const message = clientSocketMessageSchema.safeParse(payload);
        if (!message.success) {
            this.send(client.socket, { type: 'error', message: 'Unsupported WebSocket message' });
            return;
        }
        const token = readCookie(request, this.config.COOKIE_NAME);
        const user = token ? await this.authService.getSessionUser(token) : null;
        if (message.data.type === 'session.init') {
            if (!user) {
                this.send(client.socket, { type: 'error', message: 'Unauthorized socket session' });
                client.socket.close();
                return;
            }
            client.userId = user.id;
            const watchlist = await this.watchlistService.getDefaultWatchlist(user.id);
            await this.marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, watchlist);
            this.send(client.socket, {
                type: 'session.ready',
                user,
                watchlist,
                feedStatus: this.marketRuntime.getStatus(),
            });
            this.send(client.socket, {
                type: 'market.snapshot',
                ...this.marketRuntime.getSnapshot(),
            });
            return;
        }
        if (!user) {
            this.send(client.socket, { type: 'error', message: 'Unauthorized socket session' });
            return;
        }
        if (message.data.type === 'watchlist.set') {
            const symbols = await this.watchlistService.setDefaultWatchlist(user.id, message.data.symbols);
            await this.marketRuntime.setConsumerSymbols(`watchlist:${user.id}`, symbols);
            this.send(client.socket, {
                type: 'session.ready',
                user,
                watchlist: symbols,
                feedStatus: this.marketRuntime.getStatus(),
            });
            return;
        }
        if (message.data.type === 'focus.set') {
            await this.marketRuntime.setConsumerSymbols(`focus:${client.id}`, [message.data.symbol.toUpperCase()]);
        }
    }
    broadcast(message) {
        for (const client of this.clients.values()) {
            if (!client.userId) {
                continue;
            }
            this.send(client.socket, message);
        }
    }
    send(socket, message) {
        if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }
}
