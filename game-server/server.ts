import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { closePlayConnection, handlePlayMessage, openPlayConnection } from './playRooms';
import { PLAY_WS_PATH } from '../src/net/play/playProtocol';
import { BadRequestError, sendJson } from './httpUtil';
import type { ApiErrorBody } from '../src/net/protocol';

const PORT = Number(process.env.GAME_SERVER_PORT ?? 4311);
// Play Mode's rooms live entirely on the WebSocket below (see playRooms.ts);
// plain HTTP only answers health checks.

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
playSockets.on('connection', (socket) => {
  const conn = openPlayConnection((message) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  });
  socket.on('message', (data) => {
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
  socket.on('close', () => closePlayConnection(conn));
  socket.on('error', () => socket.terminate());
});
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== PLAY_WS_PATH) {
    socket.destroy();
    return;
  }
  playSockets.handleUpgrade(req, socket, head, (ws) => playSockets.emit('connection', ws, req));
});

server.listen(PORT, () => {
  console.log(`[game-server] listening on http://localhost:${PORT}`);
});
