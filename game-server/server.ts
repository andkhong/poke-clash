import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  createRoom,
  getHelloPayload,
  getRoom,
  joinRoom,
  listRooms,
  MAX_THUMBNAIL_BYTES,
  pickSpecies,
  postChat,
  setThumbnail,
  toRoomSummary,
} from './roomManager';
import { subscribe } from './sse';
import { BadRequestError, readJsonBody, readRawBody, sendJson } from './httpUtil';
import type { ApiErrorBody, ChatRequest, ChatResponse, CreateRoomRequest, JoinRoomRequest, PickSpeciesRequest } from '../src/net/protocol';
import { isRoomMode } from '../src/net/protocol';
import type { ArenaBounds } from '../src/sim/types';
import { DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH } from '../src/sim/constants';

const PORT = Number(process.env.GAME_SERVER_PORT ?? 4311);
// Keeps the previously-requested "4 rooms by default" while making Boss
// Mode / Team Mode discoverable without anyone needing to create a room for
// it first. Only one team size is seeded (matching Boss Mode's single
// starter room) — the rest are one click away via the "+ TEAM" buttons.
const INITIAL_CLASSIC_ROOM_COUNT = 3;
const INITIAL_BOSS_ROOM_COUNT = 1;

for (let i = 0; i < INITIAL_CLASSIC_ROOM_COUNT; i++) createRoom('classic');
for (let i = 0; i < INITIAL_BOSS_ROOM_COUNT; i++) createRoom('boss');
createRoom('team2');
// The landing page's always-live featured panel — see roomManager's
// startAutoPlayCycle. createRoom kicks off its first cycle itself, so it's
// already mid-cycle before any client connects. Wide arena: the featured
// panel is a landing-page hero, sized more like the desktop arena's shape
// than the portrait one the rest of the pre-seeded rooms default to.
// 6 seats rather than classic mode's usual 4 — a livelier showcase.
createRoom('classic', { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT }, { autoPlay: true, capacity: 6 });

const ID_SEGMENT = '[A-Za-z0-9_-]+';
const JOIN_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/join$`);
const PICK_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/pick$`);
const CHAT_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/chat$`);
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '';
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
    const result = joinRoom(room, parseArena(body.arena));
    if (!result.ok) {
      sendJson(res, 409, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { playerId: result.playerId, room: toRoomSummary(room) });
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
    const result = postChat(room, body.playerId ?? null, body.text, undefined, body.spectatorName);
    if (!result.ok) {
      // 429 for the rate limit so a client can tell "slow down" apart from
      // "that was malformed" by status alone.
      sendJson(res, result.error === 'rate_limited' ? 429 : 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { message: result.message } satisfies ChatResponse);
    return;
  }

  const streamMatch = STREAM_RE.exec(url);
  if (method === 'GET' && streamMatch) {
    const room = getRoom(streamMatch[1]);
    if (!room) {
      notFound(res, 'room not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.socket?.setNoDelay(true);
    res.write(`event: hello\ndata: ${JSON.stringify(getHelloPayload(room))}\n\n`);
    subscribe(room.id, req, res);
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
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      }).end(room.thumbnail);
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

server.listen(PORT, () => {
  console.log(`[game-server] listening on http://localhost:${PORT}`);
});
