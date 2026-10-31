import { useEffect, useState } from 'react';

/** `watch`: open the room as a spectator (`#/play/<id>?watch`) instead of taking a free seat. */
export type Route = { kind: 'landing' } | { kind: 'local' } | { kind: 'play'; roomId: string | null; watch?: boolean };

/** The sunset watch-mode links (`#/rooms`, `#/room/<id>`): they now land on
 * the online Play Mode room list instead. */
const LEGACY_ROOM_PATH = /^(rooms|room\/[^/]+)$/;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'local') return { kind: 'local' };
  if (path === 'play' || LEGACY_ROOM_PATH.test(path)) return { kind: 'play', roomId: null };
  const playMatch = /^play\/([a-z0-9]+)(\?watch)?$/.exec(path);
  if (playMatch) return playMatch[2] ? { kind: 'play', roomId: playMatch[1], watch: true } : { kind: 'play', roomId: playMatch[1] };
  return { kind: 'landing' };
}

/** The hash a legacy watch-mode link should be replaced with, else null. */
export function legacyRedirect(hash: string): string | null {
  return LEGACY_ROOM_PATH.test(hash.replace(/^#\/?/, '')) ? '#/play' : null;
}

function readRoute(): Route {
  const redirect = legacyRedirect(window.location.hash);
  // replaceState, so Back doesn't bounce the visitor into the redirect again.
  if (redirect) window.history.replaceState(null, '', redirect);
  return parseHash(window.location.hash);
}

/** Hash-based routing — the hash segment never round-trips to any server, so
 * this needs no server-side path-serving changes at all. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
