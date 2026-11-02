import { useEffect, useState, type ReactNode } from 'react';
import { PLAY_LEVEL } from '../../app/playMode';
import { buildSpeciesMapForLevel, moveLookup } from '../../data/loader';
import { OnlineActionEngine } from '../../net/play/OnlineActionEngine';
import { PlayConnection } from '../../net/play/playConnection';
import { SESSION_ID } from '../../net/sessionIdentity';
import { createSimStore, type SimStore } from '../state/simStore';
import { ActionMatchScreen } from './ActionMatchScreen';

interface WatchedMatch {
  engine: OnlineActionEngine;
  store: SimStore;
  names: Record<string, string>;
}

/** The landing page's live preview: watches one room over its own socket and
 * draws its match view-only. Loaded on demand (it brings the sim and the
 * species dataset), and `fallback` shows until the first match arrives. */
export function LiveRoomEmbed({ roomId, fallback }: { roomId: string; fallback: ReactNode }) {
  const [match, setMatch] = useState<WatchedMatch | null>(null);

  // Created in an effect: StrictMode's dev remount must get a fresh socket, not a closed one.
  useEffect(() => {
    const conn = new PlayConnection({ sessionId: SESSION_ID, name: 'Player' });
    let engine: OnlineActionEngine | null = null;
    const unsubscribe = conn.subscribe((m) => {
      if (m.t === 'start') {
        // '' matches no fighter: the engine only mirrors the server.
        engine = new OnlineActionEngine(m.config, buildSpeciesMapForLevel(m.config.speciesIds, PLAY_LEVEL), moveLookup, m.seed, '', () => {});
        setMatch({ engine, store: createSimStore(engine), names: m.names });
      } else if (m.t === 'snap') {
        engine?.applySnapshot(m.s, m.me);
      }
    });
    conn.send({ t: 'join', roomId, watch: true });
    return () => {
      unsubscribe();
      conn.close();
    };
  }, [roomId]);

  if (!match) return <>{fallback}</>;
  return (
    <ActionMatchScreen
      store={match.store}
      engine={match.engine}
      controller={null}
      names={match.names}
      onPlayAgain={() => {}}
      onExit={() => {}}
      preview
    />
  );
}
