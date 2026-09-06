import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'landing' }
  | { kind: 'local' }
  | { kind: 'roomList' }
  | { kind: 'room'; roomId: string };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'local') return { kind: 'local' };
  if (path === 'rooms') return { kind: 'roomList' };
  const roomMatch = /^room\/([^/]+)$/.exec(path);
  if (roomMatch) return { kind: 'room', roomId: roomMatch[1] };
  return { kind: 'landing' };
}

/** Hash-based routing — the hash segment never round-trips to any server, so
 * this needs no server-side path-serving changes at all. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
