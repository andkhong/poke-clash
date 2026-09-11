import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomPhase, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';
import { describeArenaShape } from '../arenaShape';
import { ACCENT, DESTRUCTIVE, PRIMARY, PRIMARY_TEXT, SECONDARY, TEXT, YELLOW, accentAlpha, secondaryAlpha, yellowAlpha } from '../theme';

const PHASE_LABEL: Record<RoomPhase, string> = {
  idle: 'OPEN',
  countdown: 'STARTING',
  battle: 'IN BATTLE',
  complete: 'FINISHED',
};

interface RoomCardProps {
  room: RoomSummary;
}

/** One tile in the landing page's room grid — a Twitch-style card: a
 * captured thumbnail (see useRoomThumbnailCapture, served from
 * /api/rooms/:id/thumbnail) with phase/seat/viewer badges over it, name +
 * mode tags below, the whole thing a button into that room's lobby. */
export function RoomCard({ room }: RoomCardProps) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const filled = room.slots.filter((s) => s.playerId !== null).length;
  const teamSize = teamSizeForMode(room.mode);
  const arenaShape = describeArenaShape(room.arena);
  const thumbnailSrc = room.thumbnailUpdatedAtMs !== null ? `/api/rooms/${room.id}/thumbnail?ts=${room.thumbnailUpdatedAtMs}` : null;

  // A room can have a thumbnailUpdatedAtMs but still 404 (a race with the
  // cache, or this particular capture got throttled away) — falls back to
  // the placeholder rather than showing a broken image.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [thumbnailSrc]);

  return (
    <button onClick={() => (window.location.hash = `#/room/${room.id}`)} style={cardStyle}>
      <div style={thumbWrapStyle}>
        {thumbnailSrc && !imgFailed ? (
          <img src={thumbnailSrc} alt="" style={thumbImgStyle} onError={() => setImgFailed(true)} />
        ) : (
          <div style={placeholderStyle}>
            <span style={{ fontSize: 26, opacity: 0.5 }}>🎮</span>
          </div>
        )}
        <span style={phasePillStyle(room.phase)}>{PHASE_LABEL[room.phase]}</span>
        <span style={seatPillStyle}>
          {filled}/{room.capacity}
        </span>
        <span style={viewerPillStyle}>
          {room.viewerCount} viewer{room.viewerCount === 1 ? '' : 's'}
        </span>
        {room.phase === 'countdown' && <span style={countdownPillStyle}>{Math.ceil(remainingMs / 1000)}s</span>}
      </div>

      <div style={captionStyle}>
        <span style={nameStyle}>{room.name}</span>
        <div style={tagRowStyle}>
          {room.mode === 'boss' && <span style={bossTag}>👹 BOSS</span>}
          {teamSize !== null && (
            <span style={teamTag}>
              🛡️ {teamSize}v{teamSize}
            </span>
          )}
          {arenaShape.wide && <span style={wideTag}>{arenaShape.label}</span>}
        </div>
      </div>
    </button>
  );
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 0,
  fontFamily: 'monospace',
  color: TEXT,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
};

const thumbWrapStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '4 / 5',
  borderRadius: 8,
  overflow: 'hidden',
  background: '#15181e',
  border: '1px solid rgba(255,255,255,0.12)',
};

const thumbImgStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
  imageRendering: 'pixelated',
};

const placeholderStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'radial-gradient(circle at 50% 40%, #2c3140 0%, #181b22 75%)',
};

function phasePillStyle(phase: RoomPhase): CSSProperties {
  return {
    position: 'absolute',
    top: 6,
    left: 6,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    padding: '2px 6px',
    borderRadius: 3,
    color: phase === 'battle' ? '#fff' : TEXT,
    background: phase === 'battle' ? DESTRUCTIVE : 'rgba(255,255,255,0.85)',
  };
}

const seatPillStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  fontSize: 9,
  fontWeight: 'bold',
  padding: '2px 6px',
  borderRadius: 3,
  color: '#fff',
  background: 'rgba(0,0,0,0.6)',
};

const viewerPillStyle: CSSProperties = {
  position: 'absolute',
  bottom: 6,
  left: 6,
  fontSize: 9,
  fontWeight: 'bold',
  padding: '2px 6px',
  borderRadius: 3,
  color: '#fff',
  background: 'rgba(0,0,0,0.6)',
};

const countdownPillStyle: CSSProperties = {
  position: 'absolute',
  bottom: 6,
  right: 6,
  fontSize: 9,
  fontWeight: 'bold',
  padding: '2px 6px',
  borderRadius: 3,
  color: PRIMARY_TEXT,
  background: PRIMARY,
};

const captionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '0 2px',
};

const nameStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 'bold',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const tagRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap',
};

const bossTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  color: ACCENT,
  background: accentAlpha(0.16),
  border: `1px solid ${ACCENT}`,
  borderRadius: 3,
  padding: '2px 6px',
};

const teamTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  color: SECONDARY,
  background: secondaryAlpha(0.14),
  border: `1px solid ${SECONDARY}`,
  borderRadius: 3,
  padding: '2px 6px',
};

const wideTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 'bold',
  color: YELLOW,
  background: yellowAlpha(0.16),
  border: `1px solid ${YELLOW}`,
  borderRadius: 3,
  padding: '2px 6px',
};
