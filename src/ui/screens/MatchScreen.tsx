import { useState } from 'react';
import { PhaserGame, type StageRect } from '../../render/PhaserGame';
import { RosterPanel } from '../hud/RosterPanel';
import { BannerOverlay } from '../hud/BannerOverlay';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import type { SimStore } from '../state/simStore';

interface MatchScreenProps {
  store: SimStore;
  onExit: () => void;
  /** Multiplayer spectators can't force-end a server-run match. */
  showEndMatchControl?: boolean;
  completeButtonLabel?: string;
  /** The instance id of the Pokémon the current multiplayer player picked, if any — rendered with a highlight ring. */
  highlightInstanceId?: string | null;
}

export function MatchScreen({
  store,
  onExit,
  showEndMatchControl = true,
  completeButtonLabel = 'NEW MATCH',
  highlightInstanceId = null,
}: MatchScreenProps) {
  const state = useSimSnapshot(store);
  // Phaser's FIT scaling can letterbox the canvas within this screen's full
  // area — HUD overlays need the map's actual on-screen rect, not the outer
  // container's, or they render wider/taller than the visible arena (see
  // PhaserGame's onStageRectChange). Starts null for one frame until the
  // canvas first reports in; nothing overlay-related renders until then.
  const [stageRect, setStageRect] = useState<StageRect | null>(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <PhaserGame
        engine={store.getEngine()}
        highlightInstanceId={highlightInstanceId}
        onStageRectChange={setStageRect}
      />

      {stageRect && (
        <div
          style={{
            position: 'absolute',
            left: stageRect.left,
            top: stageRect.top,
            width: stageRect.width,
            height: stageRect.height,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
            <RosterPanel state={state} />
          </div>

          <BannerOverlay state={state} />
        </div>
      )}

      {state.phase !== 'complete' && showEndMatchControl && (
        <button
          onClick={() => store.getEngine().endMatchNow()}
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            padding: '6px 14px',
            fontSize: 11,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            letterSpacing: 1,
            color: '#e8e2d4',
            background: 'rgba(20,22,28,0.75)',
            border: '1px solid rgba(232,226,212,0.4)',
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          END MATCH
        </button>
      )}

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
          {completeButtonLabel}
        </button>
      )}
    </div>
  );
}
