import type { IncomingMessage, ServerResponse } from 'node:http';

// One subscriber set per room. A subscriber is just "watching" a room's SSE
// stream — it's independent of whether that connection also claimed one of
// the room's player slots, so spectating an already-full or in-progress
// room works for free via this same registry. Each stream remembers the
// session id it was opened with (see wallets.ts), or null for a client that
// didn't send one, so per-session frames and "who's watching" lists work.
const subscribersByRoom = new Map<string, Map<ServerResponse, string | null>>();
const streamsBySession = new Map<string, Set<ServerResponse>>();

export function subscribe(roomId: string, req: IncomingMessage, res: ServerResponse, sessionId: string | null = null): void {
  let set = subscribersByRoom.get(roomId);
  if (!set) {
    set = new Map();
    subscribersByRoom.set(roomId, set);
  }
  set.set(res, sessionId);
  if (sessionId !== null) {
    let streams = streamsBySession.get(sessionId);
    if (!streams) {
      streams = new Set();
      streamsBySession.set(sessionId, streams);
    }
    streams.add(res);
  }
  const owningSet = set;
  req.on('close', () => {
    owningSet.delete(res);
    if (sessionId !== null) {
      const streams = streamsBySession.get(sessionId);
      if (streams) {
        streams.delete(res);
        if (streams.size === 0) streamsBySession.delete(sessionId);
      }
    }
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function broadcast(roomId: string, event: string, data: unknown): void {
  const set = subscribersByRoom.get(roomId);
  if (!set || set.size === 0) return;
  const text = frame(event, data);
  for (const res of set.keys()) res.write(text);
}

/** A frame for one session only — every stream that tab has open, in any
 * room. Used for wallet updates, which are that session's business alone. */
export function sendToSession(sessionId: string, event: string, data: unknown): void {
  const streams = streamsBySession.get(sessionId);
  if (!streams || streams.size === 0) return;
  const text = frame(event, data);
  for (const res of streams) res.write(text);
}

/** How many connections are currently watching this room's SSE stream —
 * seated players and spectators alike, since subscribing is independent of
 * holding a seat (see the comment above subscribersByRoom). Used as the
 * room list's live viewer count. */
export function subscriberCount(roomId: string): number {
  return subscribersByRoom.get(roomId)?.size ?? 0;
}

/** The distinct session ids currently watching this room — the "everyone
 * connected" a match's watch reward goes to. */
export function subscribedSessionIds(roomId: string): Set<string> {
  const ids = new Set<string>();
  const set = subscribersByRoom.get(roomId);
  if (set) for (const sessionId of set.values()) if (sessionId !== null) ids.add(sessionId);
  return ids;
}
