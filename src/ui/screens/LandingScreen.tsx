import { useEffect, useState } from 'react';
import type { RoomMode, RoomSummary } from '../../net/protocol';
import { teamSizeForMode } from '../../net/protocol';
import { IS_MOBILE_DEVICE, resolveMatchArena } from '../../app/config';
import { useWideArenaPreference } from '../hooks/useWideArenaPreference';
import { FeaturedRoomPanel } from '../components/FeaturedRoomPanel';
import { RoomCard } from '../components/RoomCard';
import { ContactModal } from '../landing/ContactModal';
import { HowItWorks } from '../landing/HowItWorks';
import { LandingFooter } from '../landing/LandingFooter';
import { LandingHero } from '../landing/LandingHero';
import { LandingNav } from '../landing/LandingNav';
import { LANDING_CSS } from '../landing/landingCss';
import { summarizeLiveRooms } from '../landing/liveStats';
import { pokeballUrl } from '../landing/assets';

const POLL_INTERVAL_MS = 2000;
const TEAM_MODES: RoomMode[] = ['team2', 'team3', 'team4'];
const SKELETON_CARD_COUNT = 5;

/** Consecutive failed polls before the page calls the arena offline. One
 * dropped poll on a flaky connection shouldn't flash an error at a visitor;
 * two in a row (about 4s) is a real outage. */
const OFFLINE_AFTER_FAILURES = 2;

/** Room creation is switched off while the landing page is simplified: five
 * "+ ROOM" buttons asked a first-time visitor to pick a game mode before they
 * had watched a single match. They join one of the server's pre-seeded rooms
 * from the grid instead (see game-server/server.ts's boot-time createRoom
 * calls), or hit Solo Play.
 *
 * The buttons and their handler are kept behind this flag rather than deleted
 * so bringing them back is one word. The server's POST /api/rooms is
 * deliberately untouched — nothing else calls it, and disabling the route
 * would break the flag's promise that flipping it is enough. Typed `boolean`
 * so the disabled branches don't narrow away to unreachable code. */
const ROOM_CREATION_ENABLED: boolean = false;

/** Wide Arena toggle is hidden on the landing page for now — the preference
 * (and the hook driving it) stays wired up so `resolveMatchArena` below still
 * picks the right map; only the button that lets a viewer flip it is gone. */
const WIDE_ARENA_TOGGLE_ENABLED: boolean = false;

/** Whether the hero's live pill and the featured caption show a "N watching"
 * total. Heads-up before launch: RoomSummary.viewerCount is SSE subscribers
 * *plus* live bots (game-server/roomManager.ts's toRoomSummary, around line
 * 277), so the total includes the Featured Showcase's bot audience and can
 * read as inflated social proof. Flip this to false and the pill switches to
 * "{battles} live battles · {rooms} rooms open" instead; grid cards keep
 * their per-room counts either way. Typed `boolean` for the same reason as
 * the flags above. */
const HERO_VIEWER_TOTAL_ENABLED: boolean = true;

/** The landing page — a Twitch-style discovery homepage: a sticky nav, a
 * hero with the pitch and CTAs, the server's one always-live showcase room
 * featured below it (FeaturedRoomPanel), a three-step explainer, every real
 * room as a grid of RoomCards, and a footer with the play-money / not-
 * affiliated / sprite-credit lines, plus the ContactModal the nav and footer
 * open. Room creation is folded in here too
 * behind its flag (this replaces the old separate #/rooms screen — see
 * Root.tsx, which now aliases that route to this one).
 *
 * This screen owns the data (the 2s /api/rooms poll) and the flags; the
 * pieces under src/ui/landing/ are presentational. All landing styling comes
 * from the one `<style>` rendered here (see landingCss.ts for why). */
export function LandingScreen() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failures, setFailures] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const [wideArena, setWideArena] = useWideArenaPreference();
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchRooms = () => {
      fetch('/api/rooms')
        .then((res) => {
          // A proxy error page (game-server down behind Vite/Caddy) is a
          // failure too, not just a network error.
          if (!res.ok) throw new Error(`GET /api/rooms: ${res.status}`);
          return res.json() as Promise<{ rooms?: RoomSummary[] }>;
        })
        .then((data) => {
          if (!Array.isArray(data.rooms)) throw new Error('GET /api/rooms: no rooms array');
          if (cancelled) return;
          setRooms(data.rooms);
          setLoaded(true);
          setFailures(0);
        })
        .catch(() => {
          // The game-server (npm run game-server:serve, or npm run dev:all)
          // isn't reachable — counted rather than shown straight away, see
          // OFFLINE_AFTER_FAILURES. The last good room list stays on screen.
          if (!cancelled) setFailures((f) => f + 1);
        });
    };
    fetchRooms();
    const interval = setInterval(fetchRooms, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const offline = failures >= OFFLINE_AFTER_FAILURES;
  const loading = !loaded && !offline;
  const featuredRoom = rooms.find((r) => r.autoPlay) ?? null;
  const gridRooms = rooms.filter((r) => !r.autoPlay);
  const stats = summarizeLiveRooms(rooms);
  const openContact = () => setContactOpen(true);
  const closeContact = () => setContactOpen(false);

  const createRoom = (mode: RoomMode) => {
    fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, arena: resolveMatchArena(wideArena) }),
    })
      .then((res) => res.json())
      .then((data: { room: RoomSummary }) => {
        window.location.hash = `#/room/${data.room.id}`;
      })
      .catch(() => {
        setCreateError('Couldn’t create a room. The arena server isn’t reachable.');
      });
  };

  return (
    <div className="lp-root">
      <style>{LANDING_CSS}</style>
      <LandingNav onContact={openContact} />
      <main>
        <div className="lp-container">
          <LandingHero
            featuredRoomId={featuredRoom?.id ?? null}
            stats={stats}
            loaded={loaded}
            offline={offline}
            showViewerTotal={HERO_VIEWER_TOTAL_ENABLED}
          />
          <FeaturedRoomPanel room={featuredRoom} loaded={loaded} offline={offline} showViewerCount={HERO_VIEWER_TOTAL_ENABLED} />
          <HowItWorks />

          <section className="lp-section" aria-labelledby="lp-rooms-title">
            <div className="lp-section-head">
              <h2 id="lp-rooms-title" className="lp-h2">
                LIVE ROOMS
              </h2>
              <div className="lp-section-meta">
                {loaded && !offline && (
                  <span>
                    {stats.gridCount} {stats.gridCount === 1 ? 'room' : 'rooms'} · {stats.gridBattling} in battle
                  </span>
                )}
                {WIDE_ARENA_TOGGLE_ENABLED && !IS_MOBILE_DEVICE && (
                  <button
                    type="button"
                    className="lp-btn lp-btn-ghost"
                    aria-pressed={wideArena}
                    onClick={() => setWideArena(!wideArena)}
                  >
                    WIDE ARENA: {wideArena ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>
            <p className="lp-section-sub">Watch any room, or grab an open seat and pick your own fighter.</p>

            {loading && (
              <>
                <div className="lp-room-grid" aria-hidden="true">
                  {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
                    <div key={i} className="lp-skeleton-card">
                      <div className="lp-skeleton" />
                      <div className="lp-skeleton-line" />
                    </div>
                  ))}
                </div>
                <p className="lp-sr-only" role="status">
                  Loading live rooms…
                </p>
              </>
            )}

            {loaded && gridRooms.length > 0 && (
              // role="list" because Safari drops list semantics from a
              // list-style:none list.
              <ul className="lp-room-grid" role="list">
                {gridRooms.map((room) => (
                  <li key={room.id}>
                    <RoomCard room={room} />
                  </li>
                ))}
              </ul>
            )}

            {loaded && gridRooms.length === 0 && (
              <div className="lp-info-box">
                <img src={pokeballUrl} alt="" width={30} height={30} />
                <p>No other rooms are open right now. The Featured Showcase above never stops.</p>
              </div>
            )}

            {offline && !loaded && (
              <div className="lp-info-box">
                <p>Rooms will show up here as soon as the arena is back online.</p>
              </div>
            )}

            {ROOM_CREATION_ENABLED && (
              <>
                <div className="lp-create-row">
                  <button type="button" className="lp-btn lp-btn-primary" onClick={() => createRoom('classic')}>
                    + CLASSIC ROOM
                  </button>
                  <button type="button" className="lp-btn lp-btn-secondary" onClick={() => createRoom('boss')}>
                    + BOSS ROOM
                  </button>
                  {TEAM_MODES.map((mode) => {
                    const size = teamSizeForMode(mode)!;
                    return (
                      <button key={mode} type="button" className="lp-btn lp-btn-ghost" onClick={() => createRoom(mode)}>
                        + TEAM {size}V{size}
                      </button>
                    );
                  })}
                </div>
                {createError && (
                  <p className="lp-alert" role="alert">
                    {createError}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </main>
      <LandingFooter onContact={openContact} />
      <ContactModal open={contactOpen} onClose={closeContact} />
    </div>
  );
}
