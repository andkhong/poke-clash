import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { closePlayConnection, handlePlayMessage, openLiveRooms, openPlayConnection } from './playRooms';
import { PLAY_WS_PATH } from '../src/net/play/playProtocol';
import { BadRequestError, sendJson } from './httpUtil';
import { takeToken, type RateBucket } from './rateLimit';
import type { ApiErrorBody } from '../src/net/protocol';

const PORT = Number(process.env.GAME_SERVER_PORT ?? 4311);
// Play Mode's rooms live entirely on the WebSocket below (see playRooms.ts);
// plain HTTP only answers health checks. The always-live rooms open now.
openLiveRooms();

function notFound(res: ServerResponse, message = 'not found'): void {
  sendJson(res, 404, { error: message } satisfies ApiErrorBody);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Routed on the path alone, so a query string never turns a route into a 404.
  const url = new URL(req.url ?? '/', 'http://localhost').pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res
      .writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      .end();
    return;
  }

  if (method === 'GET' && (url === '/' || url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('game-server ok');
    return;
  }

  notFound(res);
}

// Every rejection from the async handler is answered here — an unhandled
// one would exit the Node process (and, in production, the whole container:
// entrypoint.sh stops everything when any server dies), so a single
// malformed request must never get that far.
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof BadRequestError) {
      sendJson(res, error.status, { error: error.message } satisfies ApiErrorBody);
      return;
    }
    console.error('[game-server] error serving', req.method, req.url, error);
    sendJson(res, 500, { error: 'internal_error' } satisfies ApiErrorBody);
  });
});

// Online Play Mode (see playRooms.ts). A player's messages are tiny (input,
// a fire, a ping), so anything big is a misbehaving client.
const playSockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
/** Sockets one address may hold — a few tabs, not a botnet's worth of rooms. */
const MAX_SOCKETS_PER_IP = 8;
/** A client sends ~35 messages/s in a fight (30 move reports, fires, pings): this is plenty of headroom. */
const MSG_BURST = 120;
const MSG_REFILL_MS = 10;
/** Messages dropped for being over the rate before the socket is closed; refills one a second. */
const MSG_STRIKES = 120;
/** Past this much unsent data the client isn't keeping up: snapshots are dropped, and much more closes it. */
const SKIP_SNAPSHOTS_BUFFERED = 256 * 1024;
const TERMINATE_BUFFERED = 1024 * 1024;
const HEARTBEAT_MS = 30_000;
const socketsByIp = new Map<string, number>();
const alive = new WeakSet<WebSocket>();

/** The visitor's address. In production every socket arrives through Fly's
 * edge and then Caddy, so the socket's own address is a proxy's; Fly's edge
 * sets Fly-Client-IP to the real one and overwrites any a client sends, which
 * X-Forwarded-For doesn't guarantee. Locally there's no proxy, so it's the socket's. */
function clientIp(req: IncomingMessage): string {
  const fly = req.headers['fly-client-ip'];
  const flyIp = (Array.isArray(fly) ? fly[0] : fly)?.trim();
  return flyIp || req.socket.remoteAddress || 'unknown';
}

playSockets.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  const ip = clientIp(req);
  const held = socketsByIp.get(ip) ?? 0;
  if (held >= MAX_SOCKETS_PER_IP) return socket.close(1008, 'too many connections');
  socketsByIp.set(ip, held + 1);
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  const conn = openPlayConnection((message) => {
    if (socket.readyState !== socket.OPEN) return;
    if (socket.bufferedAmount > TERMINATE_BUFFERED) return socket.terminate();
    if (message.t === 'snap' && socket.bufferedAmount > SKIP_SNAPSHOTS_BUFFERED) return;
    socket.send(JSON.stringify(message));
  });
  const buckets = new Map<string, RateBucket>();
  socket.on('message', (data) => {
    const now = Date.now();
    if (!takeToken(buckets, 'msg', MSG_BURST, MSG_REFILL_MS, now)) {
      if (!takeToken(buckets, 'strike', MSG_STRIKES, 1000, now)) socket.close(1008, 'rate limited');
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    try {
      handlePlayMessage(conn, message);
    } catch (error) {
      console.error('[game-server] play message failed', error);
    }
  });
  socket.on('close', () => {
    const left = (socketsByIp.get(ip) ?? 1) - 1;
    if (left > 0) socketsByIp.set(ip, left);
    else socketsByIp.delete(ip);
    // An event-listener throw is uncaught too, and would take the process down.
    try {
      closePlayConnection(conn);
    } catch (error) {
      console.error('[game-server] play close failed', error);
    }
  });
  socket.on('error', () => socket.terminate());
});
// Standard ws heartbeat: a socket that didn't answer the last ping is dead (a phone that lost signal) — drop it.
setInterval(() => {
  for (const socket of playSockets.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, HEARTBEAT_MS).unref();
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== PLAY_WS_PATH) {
    socket.destroy();
    return;
  }
  playSockets.handleUpgrade(req, socket, head, (ws) => playSockets.emit('connection', ws, req));
});

// Local development needn't be reachable from the rest of the network.
server.listen(PORT, process.env.NODE_ENV === 'development' ? '127.0.0.1' : undefined, () => {
  console.log(`[game-server] listening on http://localhost:${PORT}`);
});
