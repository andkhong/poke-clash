import type { LiveRoomStats } from './liveStats';
import { PlayIcon } from './icons';

interface LandingHeroProps {
  /** The autoPlay showcase room's id once the room list has it — WATCH LIVE
   * links straight into it. */
  featuredRoomId: string | null;
  stats: LiveRoomStats;
  /** At least one /api/rooms poll has succeeded. */
  loaded: boolean;
  /** Two or more polls in a row have failed (see LandingScreen). */
  offline: boolean;
  /** LandingScreen's HERO_VIEWER_TOTAL_ENABLED — whether the live pill may
   * show the viewer total, which counts showcase bots. */
  showViewerTotal: boolean;
}

/** The pitch above the featured room: a live-status pill, the two-line
 * headline, one lead sentence, and the CTAs. Stacked above the embed rather
 * than beside it on desktop, since the embed carries its own 340px chat
 * sidebar at that width and a side column would squeeze its arena.
 *
 * The pill is a plain paragraph, deliberately without `aria-live`: it
 * changes on every 2s poll and would flood a screen reader. */
export function LandingHero({ featuredRoomId, stats, loaded, offline, showViewerTotal }: LandingHeroProps) {
  const loading = !loaded && !offline;
  const pill = livePill(stats, loaded, offline, showViewerTotal);

  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        <p className={pill.neutral ? 'lp-live-pill is-neutral' : 'lp-live-pill'}>
          <span className={pill.neutral ? 'lp-badge-live is-neutral' : 'lp-badge-live'}>
            <span className="lp-dot" aria-hidden="true" />
            {pill.badge}
          </span>
          <span className="lp-live-pill-text">{pill.text}</span>
        </p>
        {/* "POKÉMON ROYALE" exactly as the owner typed it — no accent, with a
            space; the nav wordmark keeps the full POKÉMON ROYALE. */}
        <h1 id="lp-hero-title" className="lp-h1">
          <span>POKÉMON </span>
          <span className="lp-h1-accent">ROYALE</span>
        </h1>
        <p className="lp-hero-tagline">Watch Pokémon brawl. Bet on the winner.</p>
        <p className="lp-lead">
          Free-for-all auto-battles, live 24/7. Grab $100 in play money, back a fighter, and cash in if it wins.
        </p>
      </div>
      <div className="lp-hero-actions">
        {featuredRoomId !== null ? (
          <a className="lp-btn lp-btn-primary" href={`#/room/${featuredRoomId}`}>
            <PlayIcon />
            WATCH LIVE
          </a>
        ) : loading ? (
          // No href until the showcase room's id arrives; role="link" keeps
          // aria-disabled meaningful on an href-less anchor.
          <a className="lp-btn lp-btn-primary is-disabled" role="link" aria-disabled="true" tabIndex={-1}>
            <PlayIcon />
            WATCH LIVE
          </a>
        ) : (
          // Offline before anything loaded, or no showcase room at all —
          // Solo Play is the one thing that still works, so it gets the
          // primary slot and the duplicate secondary button is dropped.
          <a className="lp-btn lp-btn-primary" href="#/local">
            PLAY SOLO
          </a>
        )}
        {(featuredRoomId !== null || loading) && (
          <a className="lp-btn lp-btn-secondary" href="#/local">
            PLAY SOLO
          </a>
        )}
        <p className="lp-trust">No sign-up · Play money only</p>
      </div>
    </section>
  );
}

function livePill(
  stats: LiveRoomStats,
  loaded: boolean,
  offline: boolean,
  showViewerTotal: boolean
): { badge: string; neutral: boolean; text: string } {
  if (offline) {
    return { badge: 'OFFLINE', neutral: true, text: loaded ? 'Reconnecting…' : 'Live rooms are down right now' };
  }
  if (!loaded) return { badge: 'LIVE', neutral: true, text: 'Connecting to the arena…' };

  const battles = `${stats.battling} live ${stats.battling === 1 ? 'battle' : 'battles'}`;
  const roomsOpen = `${stats.roomCount} ${stats.roomCount === 1 ? 'room' : 'rooms'} open`;
  if (showViewerTotal) {
    const watching = `${stats.watching} watching`;
    return { badge: 'LIVE', neutral: false, text: stats.battling > 0 ? `${watching} · ${battles}` : `${watching} · next battle soon` };
  }
  return { badge: 'LIVE', neutral: false, text: stats.battling > 0 ? `${battles} · ${roomsOpen}` : `${roomsOpen} · next battle soon` };
}
