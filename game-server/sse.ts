import type { IncomingMessage, ServerResponse } from 'node:http';

// One subscriber set per room. A subscriber is just "watching" a room's SSE
// stream — it's independent of whether that connection also claimed one of
// the room's 4 player slots, so spectating an already-full or in-progress
// room works for free via this same registry.
const subscribersByRoom = new Map<string, Set<ServerResponse>>();

export function subscribe(roomId: string, req: IncomingMessage, res: ServerResponse): void {
  let set = subscribersByRoom.get(roomId);
  if (!set) {
    set = new Set();
    subscribersByRoom.set(roomId, set);
  }
  set.add(res);
  const owningSet = set;
  req.on('close', () => {
    owningSet.delete(res);
  });
}

export function broadcast(roomId: string, event: string, data: unknown): void {
  const set = subscribersByRoom.get(roomId);
  if (!set || set.size === 0) return;
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(frame);
}
