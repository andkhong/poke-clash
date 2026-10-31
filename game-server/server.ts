import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createRoom,
  getHelloPayload,
  getRoom,
  joinRoom,
  listRooms,
  MAX_THUMBNAIL_BYTES,
  pickSpecies,
  placeRoomBet,
  purchaseRoomItem,
  postChat,
  setThumbnail,
  toRoomSummary,
} from './roomManager';
import { broadcast, subscribe } from './sse';
import { WebSocketServer } from 'ws';
import { closePlayConnection, handlePlayMessage, openPlayConnection } from './playRooms';
import { PLAY_WS_PATH } from '../src/net/play/playProtocol';
import { walletStreamClosed, walletStreamOpened } from './wallets';
import { BadRequestError, readJsonBody, readRawBody, sendJson } from './httpUtil';
import type {
  ApiErrorBody,
  BetRequest,
  BetResponse,
  BuyItemRequest,
  BuyItemResponse,
  ChatRequest,
  ChatResponse,
  CreateRoomRequest,
  JoinRoomRequest,
  JoinRoomResponse,
  PickSpeciesRequest,
} from '../src/net/protocol';
import { isRoomMode } from '../src/net/protocol';
import { isValidSessionId } from '../src/net/predictions';
import { isItemId, isValidInstanceId } from '../src/net/shop';
import type { ArenaBounds } from '../src/sim/types';

const PORT = Number(process.env.GAME_SERVER_PORT ?? 4311);
// Live games (AI-only watch rooms) are sunset: nothing is seeded at startup
// any more, so there are no showcase rooms and no bot audience. The /api/rooms
// routes below and roomManager.ts/bots.ts stay in place, unused, until a
// later cleanup. Play Mode's rooms (playRooms.ts) are created on demand.

const ID_SEGMENT = '[A-Za-z0-9_-]+';
const JOIN_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/join$`);
const PICK_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/pick$`);
const CHAT_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/chat$`);
const BET_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/bet$`);
const ITEM_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/item$`);
const STREAM_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/stream$`);
const THUMBNAIL_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/thumbnail$`);

function notFound(res: ServerResponse, message = 'not found'): void {
  sendJson(res, 404, { error: message } satisfies ApiErrorBody);
}

/** Bounds on a client-supplied arena side (px). The real shapes are
 * 900x1950, 1920x1080 and the custom-battle scale-downs of those; anything
 * outside this is a broken client, and a non-finite value would put NaN
 * positions into a sim every subscriber then receives. */
const MIN_ARENA_SIDE = 200;
const MAX_ARENA_SIDE = 8192;

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** CreateRoomRequest.arena / JoinRoomRequest.arena, validated: absent (the
 * server's default shape / leave the room's alone) or a pair of integer
 * sides within bounds. */
function parseArena(value: unknown): ArenaBounds | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new BadRequestError('invalid_arena');
  const { width, height } = value as { width?: unknown; height?: unknown };
  const sideOk = (side: unknown): side is number => isInteger(side) && side >= MIN_ARENA_SIDE && side <= MAX_ARENA_SIDE;
  if (!sideOk(width) || !sideOk(height)) throw new BadRequestError('invalid_arena');
  return { width, height };
}

/** Optional session id off a request body — absent is fine, malformed is not. */
function parseOptionalSessionId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidSessionId(value)) throw new BadRequestError('invalid_session');
  return value;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Routed on the path alone: a query string (`/thumbnail?ts=…` cache-busting,
  // `/stream?session=…`) must never turn a known route into a 404.
  const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
  const url = pathname;
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

  if (method === 'GET' && url === '/api/rooms') {
    sendJson(res, 200, { rooms: listRooms().map(toRoomSummary) });
    return;
  }

  if (method === 'POST' && url === '/api/rooms') {
    const body = await readJsonBody<CreateRoomRequest>(req);
    const mode = body.mode ?? 'classic';
    if (!isRoomMode(mode)) throw new BadRequestError('invalid_mode');
    const room = createRoom(mode, parseArena(body.arena));
    sendJson(res, 201, { room: toRoomSummary(room) });
    return;
  }

  const joinMatch = JOIN_RE.exec(url);
  if (method === 'POST' && joinMatch) {
    const room = getRoom(joinMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    const body = await readJsonBody<JoinRoomRequest>(req);
    if (!isValidSessionId(body.sessionId)) throw new BadRequestError('invalid_session');
    const result = joinRoom(room, parseArena(body.arena), body.sessionId);
    if (!result.ok) {
      sendJson(res, 409, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { playerId: result.playerId, slotIndex: result.slotIndex, room: toRoomSummary(room) } satisfies JoinRoomResponse);
    return;
  }

  const pickMatch = PICK_RE.exec(url);
  if (method === 'POST' && pickMatch) {
    const room = getRoom(pickMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    const body = await readJsonBody<PickSpeciesRequest>(req);
    if (typeof body.playerId !== 'string' || !isInteger(body.speciesId)) throw new BadRequestError('invalid_request');
    const result = pickSpecies(room, body.playerId, body.speciesId);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { room: toRoomSummary(room) });
    return;
  }

  const chatMatch = CHAT_RE.exec(url);
  if (method === 'POST' && chatMatch) {
    const room = getRoom(chatMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    const body = await readJsonBody<ChatRequest>(req);
    if (typeof body.text !== 'string') throw new BadRequestError('invalid_request');
    if (body.playerId !== undefined && typeof body.playerId !== 'string') throw new BadRequestError('invalid_request');
    if (body.spectatorName !== undefined && typeof body.spectatorName !== 'string') throw new BadRequestError('invalid_request');
    const result = postChat(room, body.playerId ?? null, body.text, undefined, body.spectatorName, parseOptionalSessionId(body.sessionId));
    if (!result.ok) {
      // 429 for the rate limit so a client can tell "slow down" apart from
      // "that was malformed" by status alone.
      sendJson(res, result.error === 'rate_limited' ? 429 : 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { message: result.message } satisfies ChatResponse);
    return;
  }

  const betMatch = BET_RE.exec(url);
  if (method === 'POST' && betMatch) {
    const room = getRoom(betMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    const body = await readJsonBody<BetRequest>(req);
    if (!isValidSessionId(body.sessionId) || typeof body.optionId !== 'string' || !isInteger(body.amount)) {
      throw new BadRequestError('invalid_request');
    }
    const result = placeRoomBet(room, body.sessionId, body.optionId, body.amount);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { wallet: { balance: result.balance }, myBet: result.bet, prediction: result.prediction } satisfies BetResponse);
    return;
  }

  const itemMatch = ITEM_RE.exec(url);
  if (method === 'POST' && itemMatch) {
    const room = getRoom(itemMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    const body = await readJsonBody<BuyItemRequest>(req);
    if (!isValidSessionId(body.sessionId) || !isItemId(body.itemId) || !isValidInstanceId(body.targetInstanceId)) {
      throw new BadRequestError('invalid_request');
    }
    const result = purchaseRoomItem(room, body.sessionId, body.itemId, body.targetInstanceId, body.spectatorName);
    if (!result.ok) {
      sendJson(res, result.error === 'rate_limited' ? 429 : 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, {
      wallet: { balance: result.balance },
      myItemUses: result.myItemUses,
      use: result.use,
      shop: result.shop,
    } satisfies BuyItemResponse);
    return;
  }

  const streamMatch = STREAM_RE.exec(url);
  if (method === 'GET' && streamMatch) {
    const room = getRoom(streamMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }
    // The tab's session (see src/net/sessionIdentity.ts) rides on the stream
    // URL — an EventSource can't send headers or a body. A stream without
    // one still works, it just has no wallet.
    const rawSession = searchParams.get('session');
    const sessionId = isValidSessionId(rawSession) ? rawSession : null;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.socket?.setNoDelay(true);
    if (sessionId !== null) walletStreamOpened(sessionId);
    res.write(`event: hello\ndata: ${JSON.stringify(getHelloPayload(room, sessionId))}\n\n`);
    subscribe(room.id, req, res, sessionId);
    // RoomSummary.viewerCount is read off the subscriber set, so everyone
    // watching learns of a viewer arriving or leaving the moment it happens
    // (the match HUD shows it live), not only when a seat or the phase next
    // changes. sse.ts's own close listener runs first (registered inside
    // subscribe), so the count broadcast here already excludes the leaver.
    broadcast(room.id, 'roomUpdate', toRoomSummary(room));
    req.on('close', () => {
      if (sessionId !== null) walletStreamClosed(sessionId);
      broadcast(room.id, 'roomUpdate', toRoomSummary(room));
    });
    return;
  }

  const thumbnailMatch = THUMBNAIL_RE.exec(url);
  if (thumbnailMatch) {
    const room = getRoom(thumbnailMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }

    if (method === 'GET') {
      if (!room.thumbnail) {
        notFound(res, 'no thumbnail yet');
        return;
      }
      res
        .writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        })
        .end(room.thumbnail);
      return;
    }

    if (method === 'POST') {
      // A few hundred px wide downscaled capture (see
      // useRoomThumbnailCapture.ts) is nowhere near MAX_THUMBNAIL_BYTES, so
      // this cap is generous — readRawBody's own guard rejects anything
      // wildly oversized before it's fully buffered.
      const image = await readRawBody(req, MAX_THUMBNAIL_BYTES);
      if (image.byteLength === 0) throw new BadRequestError('empty_body');
      // A throttled/oversized upload isn't a client error worth surfacing —
      // it's expected under multiple simultaneous viewers — so this just
      // no-ops with 204 either way rather than a 4xx the uploader would need
      // to handle.
      setThumbnail(room, image);
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end();
      return;
    }
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
