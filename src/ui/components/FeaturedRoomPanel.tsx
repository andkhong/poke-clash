import { useEffect, useRef } from 'react';
import type { RoomPhase, RoomSummary } from '../../net/protocol';
import { RoomScreen } from '../screens/RoomScreen';
import { pokeballUrl } from '../landing/assets';

interface FeaturedRoomPanelProps {
  /** The server's autoPlay showcase room, or null while the room list is
   * still loading, unreachable, or (rarely) lists no showcase room at all. */
  room: RoomSummary | null;
  /** At least one /api/rooms poll has succeeded (see LandingScreen). */
  loaded: boolean;
  /** Two or more polls in a row have failed. */
  offline: boolean;
  /** LandingScreen's HERO_VIEWER_TOTAL_ENABLED — whether the caption may show
   * this room's viewerCount, which includes its bot audience. */
  showViewerCount: boolean;
}

const FALLBACK_NAME = 'Featured Showcase';

const PHASE_META: Record<RoomPhase, string> = {
  battle: 'Battle in progress · bets close 45s in',
  countdown: 'Next round starting…',
  idle: 'Next round starting…',
  complete: 'Round over · next one in a few seconds',
};

/** The landing page's always-live hero: the server's one permanent,
 * bot-driven showcase room (see game-server/roomManager.ts's
 * startAutoPlayCycle) embedded directly via RoomScreen — it's spectate-only
 * and loops battle after battle forever, so there's always something live to
 * show without waiting on a real player.
 *
 * The frame is sized for the arena the showcase actually runs (the 16:9 wide
 * one), not a fixed height: below 900px it is simply 16:9, and from 900px up
 * — where RoomScreen puts its 340px chat sidebar beside the arena, same as
 * the full #/room/:id route — its height is derived from the container width
 * minus that sidebar (see landingCss.ts's .lp-featured-frame), so the arena
 * region stays 16:9 too. Phaser's FIT scaling still letterboxes inside
 * whatever box it gets; this just keeps the letterbox bands to a sliver.
 *
 * A transparent overlay button covers the whole embed and routes to the
 * room's own full page on click — every click, including one aimed at the
 * embedded chat, since the destination page has that same chat itself; this
 * keeps the landing-page embed a single clickable preview rather than a
 * partially-interactive one (typing into the embedded composer would be a
 * dead end otherwise, since RoomScreen unmounts on navigation anyway). The
 * overlay covers pointers only, though, so the embed's wrapper is also
 * `inert` + `aria-hidden`: without that, Tab would still walk through the
 * embed's chat composer, SEND and BETS/SHOP tabs as invisible stops.
 *
 * Its LIVE / ENTER ROOM chips sit top-left, away from the embedded chat
 * composer below, so they don't look like they're covering up a broken
 * control. The room's name, phase and viewer count live in a caption bar
 * under the frame rather than on it, where they'd collide with the embed's
 * mobile chat ticker. */
export function FeaturedRoomPanel({ room, loaded, offline, showViewerCount }: FeaturedRoomPanelProps) {
  const embedRef = useRef<HTMLDivElement>(null);
  const roomId = room?.id ?? null;

  // React 18's DOM typings have no `inert` prop, so it's set by hand. Keyed
  // on the room id because the embed wrapper remounts when the room appears.
  useEffect(() => {
    embedRef.current?.setAttribute('inert', '');
  }, [roomId]);

  const roomName = room?.name || FALLBACK_NAME;

  if (room === null) {
    const loading = !loaded && !offline;
    return (
      <section className="lp-featured" aria-labelledby="lp-featured-title">
        {/* Keeps aria-labelledby pointing at something while there's no
            caption bar to hold the visible title. */}
        <h2 id="lp-featured-title" className="lp-sr-only">
          {FALLBACK_NAME}
        </h2>
        {loading ? (
          <div className="lp-featured-frame" role="status">
            <div className="lp-frame-state">
              <img className="lp-bob" src={pokeballUrl} alt="" width={60} height={60} />
              <p>Connecting to the live arena…</p>
            </div>
          </div>
        ) : (
          <div className="lp-featured-frame" role={offline ? 'alert' : 'status'}>
            <div className="lp-frame-state is-offline">
              <img src={pokeballUrl} alt="" width={60} height={60} />
              <h3>{offline ? 'ARENA OFFLINE' : 'SHOWCASE PAUSED'}</h3>
              <p>
                {offline
                  ? 'Can’t reach the live rooms right now. We’ll keep retrying.'
                  : 'The featured battle is taking a breather. Pick a room below or play solo.'}
              </p>
              <a className="lp-btn lp-btn-secondary" href="#/local">
                PLAY SOLO INSTEAD
              </a>
            </div>
          </div>
        )}
      </section>
    );
  }

  const meta = showViewerCount ? `${PHASE_META[room.phase]} · ${room.viewerCount} watching` : PHASE_META[room.phase];

  return (
    <section className="lp-featured" aria-labelledby="lp-featured-title">
      <div className="lp-featured-frame">
        <div className="lp-featured-embed" ref={embedRef} aria-hidden="true">
          <RoomScreen roomId={room.id} embedded />
        </div>
        <button
          type="button"
          className="lp-featured-overlay"
          onClick={() => (window.location.hash = `#/room/${room.id}`)}
          aria-label={`Enter ${roomName} to watch, chat and bet`}
        >
          <span className="lp-featured-chips" aria-hidden="true">
            <span className="lp-badge-live">
              <span className="lp-dot" />
              LIVE
            </span>
            <span className="lp-chip-enter">
              ENTER ROOM <span className="lp-arrow">→</span>
            </span>
          </span>
        </button>
      </div>
      <div className="lp-featured-caption">
        <div className="lp-featured-caption-text">
          <h2 id="lp-featured-title" className="lp-featured-title">
            {roomName}
          </h2>
          <p className="lp-featured-meta">{meta}</p>
        </div>
        <a className="lp-btn lp-btn-ghost" href={`#/room/${room.id}`} aria-label={`Enter ${roomName}`}>
          ENTER ROOM{' '}
          <span className="lp-arrow" aria-hidden="true">
            →
          </span>
        </a>
      </div>
    </section>
  );
}
