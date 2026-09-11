import type { CSSProperties } from 'react';
import { RoomScreen } from '../screens/RoomScreen';
import { PRIMARY_TEXT, primaryAlpha } from '../theme';

interface FeaturedRoomPanelProps {
  roomId: string;
}

/** The landing page's always-live hero: the server's one permanent,
 * bot-driven showcase room (see game-server/roomManager.ts's
 * startAutoPlayCycle) embedded directly via RoomScreen — it's spectate-only
 * and loops battle after battle forever, so there's always something live to
 * show without waiting on a real player.
 *
 * Deliberately not boxed to the arena's own aspect ratio: on a wide viewport
 * RoomScreen places a chat sidebar beside the arena (same as the full
 * #/room/:id route), which needs real width of its own — Phaser's FIT
 * scaling already letterboxes the arena correctly inside whatever box its
 * own region ends up with, so this just needs to be a reasonably sized box,
 * not an aspect-ratio-matched one.
 *
 * A transparent overlay button covers the whole embed and routes to the
 * room's own full page on click — every click, including one aimed at the
 * embedded chat, since the destination page has that same chat itself; this
 * keeps the landing-page embed a single clickable preview rather than a
 * partially-interactive one (typing into the embedded composer would be a
 * dead end otherwise, since RoomScreen unmounts on navigation anyway). */
export function FeaturedRoomPanel({ roomId }: FeaturedRoomPanelProps) {
  return (
    <div style={frameStyle}>
      <RoomScreen roomId={roomId} embedded />
      <button
        onClick={() => (window.location.hash = `#/room/${roomId}`)}
        style={clickOverlayStyle}
        aria-label="Open this room's full page, with chat"
      >
        <span style={enterLabelStyle}>OPEN ROOM &amp; CHAT →</span>
      </button>
    </div>
  );
}

const frameStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: 1000,
  height: 'min(70vh, 640px)',
  minHeight: 360,
  margin: '0 auto',
  background: '#000',
  borderRadius: 10,
  overflow: 'hidden',
  border: '1px solid rgba(255,255,255,0.12)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
};

const clickOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  padding: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  // Top-left rather than a corner nearer the embedded chat composer/SEND
  // button below — this label sits on top of controls that look clickable
  // but no longer do anything but navigate (the whole frame is one big
  // button), so it's placed away from them to avoid looking like it's
  // covering up a broken control.
  alignItems: 'flex-start',
  justifyContent: 'flex-start',
};

const enterLabelStyle: CSSProperties = {
  margin: 12,
  padding: '5px 10px',
  fontFamily: 'monospace',
  fontSize: 10,
  fontWeight: 'bold',
  letterSpacing: 0.5,
  color: PRIMARY_TEXT,
  background: primaryAlpha(0.92),
  borderRadius: 4,
};
