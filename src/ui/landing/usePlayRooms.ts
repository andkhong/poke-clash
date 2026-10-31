import { useEffect, useState } from 'react';
import { PlayConnection } from '../../net/play/playConnection';
import type { PlayRoomSummary } from '../../net/play/playProtocol';
import { SESSION_ID } from '../../net/sessionIdentity';

const ROOM_LIST_POLL_MS = 3000;

export type PlayRoomsStatus = 'loading' | 'live' | 'offline';

/** The online Play Mode rooms, live: one PlayConnection asks for the list
 * every few seconds and is closed on unmount. The landing never joins a room,
 * so its hello name is never shown to anyone.
 * shortcut: no reconnect after the socket drops; the list stays offline until
 * a reload. Add a backoff retry if game-server restarts strand visitors. */
export function usePlayRooms(): { rooms: PlayRoomSummary[]; status: PlayRoomsStatus } {
  const [rooms, setRooms] = useState<PlayRoomSummary[]>([]);
  const [status, setStatus] = useState<PlayRoomsStatus>('loading');

  // Created in an effect: StrictMode's dev remount must get a fresh socket, not a closed one.
  useEffect(() => {
    const conn = new PlayConnection({ sessionId: SESSION_ID, name: 'Player' });
    const unsubscribe = conn.subscribe((m) => {
      if (m.t === 'rooms') {
        setRooms(m.rooms);
        setStatus('live');
      } else if (m.t === 'closed') {
        setStatus('offline');
      }
    });
    conn.send({ t: 'list' });
    const poll = setInterval(() => conn.send({ t: 'list' }), ROOM_LIST_POLL_MS);
    return () => {
      clearInterval(poll);
      unsubscribe();
      conn.close();
    };
  }, []);

  return { rooms, status };
}
