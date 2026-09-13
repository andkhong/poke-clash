import { useEffect, useState } from 'react';
import type { RoomMode, RoomPhase, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { useCountdown } from '../../net/useCountdown';
import { describeArenaShape } from '../arenaShape';
import { pokeballUrl } from '../landing/assets';

interface RoomCardProps {
  room: RoomSummary;
}

/** Shown over the striped placeholder when a room has no captured thumbnail
 * yet — says what's going on inside instead of a blank tile. */
const PLACEHOLDER_CAPTION: Record<RoomPhase, string> = {
  idle: 'WAITING FOR PLAYERS',
  countdown: 'STARTING SOON',
  battle: 'BATTLE IN PROGRESS',
  complete: 'ROUND OVER',
};

/** One tile in the landing page's room grid — a Twitch-style card: a
 * captured thumbnail (see useRoomThumbnailCapture, served from
 * /api/rooms/:id/thumbnail) with phase/seat/viewer pills over it, name +
 * mode chips below, the whole thing a button into that room's lobby.
 *
 * Styled entirely by landingCss.ts's `lp-card` classes, so it only renders
 * correctly inside LandingScreen (its one caller). Below 600px the same
 * markup reflows into a compact row — small thumbnail, name, chips, a
 * "seats · watching" meta line, chevron — which is why the phase pill is
 * rendered twice: once over the thumbnail, once inline for that layout. The
 * button's aria-label speaks the whole card, so the pills and thumbnail
 * are left out of the accessible name. */
export function RoomCard({ room }: RoomCardProps) {
  const remainingMs = useCountdown(room.countdownEndsAtMs);
  const filled = room.slots.filter((s) => s.occupied).length;
  const arenaShape = describeArenaShape(room.arena);
  const thumbnailSrc = room.thumbnailUpdatedAtMs !== null ? `/api/rooms/${room.id}/thumbnail?ts=${room.thumbnailUpdatedAtMs}` : null;

  // A room can have a thumbnailUpdatedAtMs but still 404 (a race with the
  // cache, or this particular capture got throttled away) — falls back to
  // the placeholder rather than showing a broken image.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [thumbnailSrc]);

  const phase = phasePill(room.phase, Math.max(0, Math.ceil(remainingMs / 1000)));
  const mode = modeChip(room.mode);
  const phasePillContent = (
    <>
      {room.phase === 'battle' && <span className="lp-dot" />}
      {phase.label}
    </>
  );

  return (
    <button
      type="button"
      className="lp-card"
      onClick={() => (window.location.hash = `#/room/${room.id}`)}
      aria-label={`${room.name}, ${phase.spoken}, ${filled} of ${room.capacity} seats taken, ${room.viewerCount} watching. Open room.`}
    >
      <div className="lp-card-thumb">
        {thumbnailSrc && !imgFailed ? (
          <img src={thumbnailSrc} alt="" onError={() => setImgFailed(true)} />
        ) : (
          <div className="lp-card-placeholder">
            <img src={pokeballUrl} alt="" width={60} height={60} />
            <span>{PLACEHOLDER_CAPTION[room.phase]}</span>
          </div>
        )}
        <span className={`lp-pill lp-pill-tl ${phase.variant}`}>{phasePillContent}</span>
        <span className="lp-pill lp-pill-tr lp-pill-dark">
          {filled}/{room.capacity} SEATS
        </span>
        <span className="lp-pill lp-pill-bl lp-pill-dark">{room.viewerCount} WATCHING</span>
      </div>

      <div className="lp-card-body">
        <span className="lp-card-name">{room.name}</span>
        <div className="lp-chip-row">
          <span className={`lp-pill lp-pill-inline ${phase.variant}`}>{phasePillContent}</span>
          <span className={`lp-chip ${mode.variant}`}>{mode.label}</span>
          {arenaShape.wide && <span className="lp-chip lp-chip-wide">WIDE ARENA</span>}
        </div>
        <span className="lp-card-meta">
          {filled}/{room.capacity} seats · {room.viewerCount} watching
        </span>
      </div>
      <span className="lp-card-chevron" aria-hidden="true">
        →
      </span>
    </button>
  );
}

/** The phase pill's visible label, what the card's aria-label says instead,
 * and its color variant. The countdown folds into the label itself. */
function phasePill(phase: RoomPhase, seconds: number): { label: string; spoken: string; variant: string } {
  switch (phase) {
    case 'idle':
      return { label: 'OPEN', spoken: 'open', variant: 'lp-pill-light' };
    case 'countdown':
      return { label: `STARTING · ${seconds}s`, spoken: `starting in ${seconds} seconds`, variant: 'lp-pill-starting' };
    case 'battle':
      return { label: 'IN BATTLE', spoken: 'battle in progress', variant: 'lp-pill-battle' };
    case 'complete':
      return { label: 'FINISHED', spoken: 'finished', variant: 'lp-pill-light' };
  }
}

function modeChip(mode: RoomMode): { label: string; variant: string } {
  const teamSize = teamSizeForMode(mode);
  if (teamSize !== null) return { label: `TEAM ${teamSize}V${teamSize}`, variant: 'lp-chip-team' };
  if (mode === 'boss') return { label: 'BOSS BATTLE', variant: 'lp-chip-boss' };
  return { label: 'FREE-FOR-ALL', variant: 'lp-chip-ffa' };
}
