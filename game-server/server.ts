import { createServer, type ServerResponse } from 'node:http';
import { createRoom, getHelloPayload, getRoom, joinRoom, listRooms, pickSpecies, toRoomSummary } from './roomManager';
import { subscribe } from './sse';
import { readJsonBody, sendJson } from './httpUtil';
import type { ApiErrorBody, CreateRoomRequest, PickSpeciesRequest } from '../src/net/protocol';

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

const ID_SEGMENT = '[A-Za-z0-9_-]+';
const JOIN_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/join$`);
const PICK_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/pick$`);
const STREAM_RE = new RegExp(`^/api/rooms/(${ID_SEGMENT})/stream$`);

function notFound(res: ServerResponse, message = 'not found'): void {
  sendJson(res, 404, { error: message } satisfies ApiErrorBody);
}

const server = createServer(async (req, res) => {
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
    const room = createRoom(body.mode ?? 'classic', body.arena);
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
    const result = joinRoom(room);
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
    const result = pickSpecies(room, body.playerId, body.speciesId);
    if (!result.ok) {
      sendJson(res, 400, { error: result.error } satisfies ApiErrorBody);
      return;
    }
    sendJson(res, 200, { room: toRoomSummary(room) });
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

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`[game-server] listening on http://localhost:${PORT}`);
});
