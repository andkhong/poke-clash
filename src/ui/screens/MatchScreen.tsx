import { PhaserGame } from '../../render/PhaserGame';
import { RosterPanel } from '../hud/RosterPanel';
import { BannerOverlay } from '../hud/BannerOverlay';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import type { SimStore } from '../state/simStore';

interface MatchScreenProps {
  store: SimStore;
  onExit: () => void;
}

export function MatchScreen({ store, onExit }: MatchScreenProps) {
  const state = useSimSnapshot(store);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <PhaserGame engine={store.getEngine()} />

      <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <RosterPanel state={state} />
      </div>

      <BannerOverlay state={state} />

      {state.phase === 'complete' && (
        <button
          onClick={onExit}
          style={{
            position: 'absolute',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '10px 26px',
            fontSize: 14,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            letterSpacing: 1,
            color: '#20242c',
            background: '#e0b030',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          NEW MATCH
        </button>
      )}
    </div>
  );
}
