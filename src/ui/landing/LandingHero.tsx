import { CrowdIcon, PlayIcon } from './icons';
import { HERO_FIGHTERS, idleSpriteClass } from './courtSprites';

interface LandingHeroProps {
  /** Players seated in online rooms right now, or null until the room list
   * loads. The pill only shows a real, non-zero count. */
  playersOnline: number | null;
  /** Scrolls to the open-rooms list, where the crowd links are. */
  onWatch: () => void;
}

/** The pitch: a players-online pill (real data only), the headline, the
 * three ways in (solo, online, crowd), and a CSS-drawn court showing a
 * Crowd Call landing. The court is decoration, not a live preview. */
export function LandingHero({ playersOnline, onWatch }: LandingHeroProps) {
  return (
    <section className="lp-hero lp-container" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        {playersOnline !== null && playersOnline > 0 && (
          <p className="lp-pill">
            <span className="lp-pill-dot" aria-hidden="true" />
            {playersOnline} playing online now
          </p>
        )}
        <h1 id="lp-hero-title" className="lp-h1">
          You fight. <span className="lp-crowd-text">The crowd calls it.</span>
        </h1>
        <p className="lp-lead">
          Real-time Pokémon brawls in your browser. Move, dodge, aim four moves, take three lives into a three-minute match. Everyone
          watching votes on what lands on the court next.
        </p>
        <div className="lp-hero-actions">
          <a className="lp-btn lp-btn-primary lp-btn-xl" href="#/local">
            <PlayIcon />
            Play now
          </a>
          <a className="lp-btn lp-btn-secondary lp-btn-xl" href="#/play">
            Play online
          </a>
          <button type="button" className="lp-btn lp-btn-crowd-outline lp-btn-xl" onClick={onWatch}>
            <CrowdIcon />
            Watch &amp; join the crowd
          </button>
        </div>
        <p className="lp-trust">Free. No account, no download. Bots fill empty seats, so a match starts in seconds.</p>
      </div>
      <HeroCourt />
    </section>
  );
}

function HeroCourt() {
  return (
    <div
      className="lp-hero-art"
      role="img"
      aria-label="Illustration: Charmander and Pikachu for Team Ruby face Squirtle and Bulbasaur for Team Sapphire, whose crowd has called a Shield"
    >
      <div className="lp-court">
        <span className="lp-court-line" />
        <span className="lp-court-circle" />
        {HERO_FIGHTERS.map((f) => (
          <span key={f.id} className={`lp-fighter ${f.slot}${f.hideOnMobile ? ' lp-hide-mobile' : ''}`}>
            {f.shielded && <span className="lp-fighter-shield" />}
            <span className={`lp-fighter-mark lp-fighter-mark-${f.team}`} />
            <span className={idleSpriteClass(f.id, f.row)} />
          </span>
        ))}
      </div>
      <div className="lp-msgbox lp-hero-msg">
        <span>
          Sapphire&rsquo;s crowd called <strong className="lp-crowd-text">SHIELD</strong>!
          <span className="lp-hide-mobile"> It lands in 2.</span>
        </span>
      </div>
    </div>
  );
}
