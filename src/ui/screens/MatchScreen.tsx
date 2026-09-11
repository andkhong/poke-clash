import { lazy, Suspense, useState, type CSSProperties } from 'react';
import type { StageRect } from '../../render/PhaserGame';

// Phaser (and everything under src/render/) is only ever needed once a match
// starts, and it's most of the JavaScript — a dynamic import here keeps it
// out of the bundle the landing and setup screens load. The type import
// above is erased at build time, so it doesn't pull the module in.
const PhaserGame = lazy(() => import('../../render/PhaserGame').then((m) => ({ default: m.PhaserGame })));
import { RosterPanel } from '../hud/RosterPanel';
import { MatchTimer } from '../hud/MatchTimer';
import { BannerOverlay } from '../hud/BannerOverlay';
import { ChatOverlay, type ChatOverlayProps } from '../chat/ChatOverlay';
import { useSimSnapshot } from '../hooks/useSimSnapshot';
import type { SimStore } from '../state/simStore';
import { isMobileArena } from '../../sim/constants';
import { PRIMARY, PRIMARY_TEXT } from '../theme';

interface MatchScreenProps {
  store: SimStore;
  onExit: () => void;
  /** Multiplayer spectators can't force-end a server-run match. */
  showEndMatchControl?: boolean;
  /** Multiplayer: a small, always-present way out of a match that's still
   * running (calls `onExit`, same as the post-match button) — nobody in a
   * room can end a server-run match, but anyone can leave it, and without
   * this the only exit was the post-match button, which shows for just the
   * few seconds before the room resets to its lobby. Sits where solo play's
   * END MATCH control does; solo play leaves this unset. */
  leaveControlLabel?: string;
  completeButtonLabel?: string;
  /** The instance id of the Pokémon the current multiplayer player picked, if any — rendered with a highlight ring. */
  highlightInstanceId?: string | null;
  /** Multiplayer room chat, drawn over the arena as a button + ticker +
   * drawer (see ChatOverlay). Only for the narrow/mobile layout — on a wide
   * viewport RoomScreen shows the chat as a sidebar beside this screen
   * instead and passes nothing here. Solo Play has no chat at all. */
  chat?: ChatOverlayProps;
  /** Multiplayer only (see useRoomThumbnailCapture) — solo play has no room
   * to attribute a captured frame to, so App.tsx never passes this. */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  /** See PhaserGame's captureFrames — true only for a multiplayer room whose
   * frames feed the landing page's thumbnail grid. */
  captureFrames?: boolean;
  /** Overrides the banner overlay's own text — see BannerOverlay's
   * `overrideText`. Used by the always-on showcase room to show "next round
   * in Ns" over the arena during its post-match gap, when `store`'s sim
   * state is still frozen on the finished match (RoomScreen keeps the last
   * match's engine/store alive there instead of tearing the arena down). */
  bannerOverrideText?: string;
}

export function MatchScreen({
  store,
  onExit,
  showEndMatchControl = true,
  leaveControlLabel,
  completeButtonLabel = 'NEW MATCH',
  highlightInstanceId = null,
  chat,
  onCanvasReady,
  captureFrames = false,
  bannerOverrideText,
}: MatchScreenProps) {
  const state = useSimSnapshot(store);
  // Phaser's FIT scaling can letterbox the canvas within this screen's full
  // area — HUD overlays need the map's actual on-screen rect, not the outer
  // container's, or they render wider/taller than the visible arena (see
  // PhaserGame's onStageRectChange). Starts null for one frame until the
  // canvas first reports in; nothing overlay-related renders until then.
  const [stageRect, setStageRect] = useState<StageRect | null>(null);

  // A portrait/mobile arena fills the whole page edge-to-edge, same as
  // always — it's meant to become full-bleed vertical video. A landscape
  // desktop arena instead sits in a bounded, centered panel with the page's
  // own background showing around it, per the "won't take the entire
  // screen" design — a wide arena filling an ultrawide monitor edge-to-edge
  // would just be an even more extreme letterbox than the portrait shape
  // ever was.
  const isMobile = isMobileArena(state.arena);

  return (
    <div style={pageStyle}>
      <div style={isMobile ? mobileFrameStyle : desktopFrameStyle}>
        {/* The frame is already black while the chunk loads — nothing to show. */}
        <Suspense fallback={null}>
          <PhaserGame
            engine={store.getEngine()}
            highlightInstanceId={highlightInstanceId}
            onStageRectChange={setStageRect}
            onCanvasReady={onCanvasReady}
            captureFrames={captureFrames}
          />
        </Suspense>

        {stageRect && (
          // Sized/positioned to the canvas's real on-screen rect, not the
          // frame's — FIT scaling can pillarbox/letterbox the canvas within
          // the frame (most visibly on the new desktop arena's much wider
          // frame), and anchoring to the frame instead of this rect left
          // both the HUD and these buttons floating off-center over empty
          // letterbox space rather than the visible arena.
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
              <MatchTimer state={state} />
            </div>

            {/* Not nested in the top-anchored div above: on the wide arena
                RosterPanel positions itself as two full-height side columns
                (see RosterPanel's own isMobileArena branch), which needs a
                containing block sized to the whole stage, not one that
                auto-collapses to the timer's height. */}
            <RosterPanel state={state} />

            <BannerOverlay state={state} overrideText={bannerOverrideText} />

            {state.phase !== 'complete' && showEndMatchControl && (
              <button
                onClick={() => store.getEngine().endMatchNow()}
                style={{ ...endMatchButtonStyle, pointerEvents: 'auto' }}
              >
                END MATCH
              </button>
            )}

            {state.phase !== 'complete' && leaveControlLabel && (
              <button onClick={onExit} style={{ ...endMatchButtonStyle, pointerEvents: 'auto' }}>
                {leaveControlLabel}
              </button>
            )}

            {state.phase === 'complete' && (
              <button onClick={onExit} style={{ ...completeButtonStyle, pointerEvents: 'auto' }}>
                {completeButtonLabel}
              </button>
            )}

            {/* Last so its drawer paints above the roster panel and banners. */}
            {chat && <ChatOverlay {...chat} />}
          </div>
        )}
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#101216',
};

const mobileFrameStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  background: '#000',
};

// Percent of the parent rather than vw: on a wide viewport RoomScreen places
// a chat sidebar beside this screen, so the frame has to size to the arena
// region it's actually given, not the whole window. Capped well above any
// realistic viewport (rather than left uncapped) only so an ultra-wide
// monitor's frame can't grow large enough to make Pokémon sprites — sized in
// fixed game-world pixels — look tiny relative to it. Raised from the
// original 92%/1200px/92vh caps, which left a lot of the page's own
// background showing around the frame on anything but a wide, short window.
const desktopFrameStyle: CSSProperties = {
  position: 'relative',
  width: 'min(98%, 1800px)',
  aspectRatio: '16 / 9',
  maxHeight: '98vh',
  background: '#000',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
  overflow: 'hidden',
};

// Positioned absolute within the stageRect box above, so these sit at the
// visible arena's own corner (see that box's own comment). The safe-area
// insets only matter on mobile (iPhone home-indicator / Android gesture bar)
// but cost nothing to include on desktop, where they're just 0.
const endMatchButtonStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'max(16px, env(safe-area-inset-bottom))',
  right: 'max(16px, env(safe-area-inset-right))',
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
};

const completeButtonStyle: CSSProperties = {
  position: 'absolute',
  bottom: 'max(28px, env(safe-area-inset-bottom))',
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 26px',
  fontSize: 14,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  letterSpacing: 1,
  color: PRIMARY_TEXT,
  background: PRIMARY,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};
