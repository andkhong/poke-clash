import { FormattedMessage, useIntl } from 'react-intl';
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
  const intl = useIntl();
  return (
    <section className="lp-hero lp-container" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        {playersOnline !== null && playersOnline > 0 && (
          <p className="lp-pill">
            <span className="lp-pill-dot" aria-hidden="true" />
            {intl.formatMessage(
              {
                id: 'landing.hero.playersOnline',
                defaultMessage: '{count} playing online now',
              },
              { count: playersOnline }
            )}
          </p>
        )}
        <h1 id="lp-hero-title" className="lp-h1">
          <FormattedMessage
            id="landing.hero.title"
            defaultMessage="You fight. <crowd>The crowd calls it.</crowd>"
            values={{
              crowd: (chunks) => <span className="lp-crowd-text">{chunks}</span>,
            }}
          />
        </h1>
        <p className="lp-lead">
          {intl.formatMessage({
            id: 'landing.hero.lead',
            defaultMessage:
              "Real-time Pokémon brawls in your browser. Move, dodge, aim four moves, one KO and you're out. Everyone watching votes on what lands on the court next.",
          })}
        </p>
        <div className="lp-hero-actions">
          <a className="lp-btn lp-btn-primary lp-btn-xl" href="#/local">
            <PlayIcon />
            {intl.formatMessage({
              id: 'landing.hero.playNow',
              defaultMessage: 'Play now',
            })}
          </a>
          <a className="lp-btn lp-btn-secondary lp-btn-xl" href="#/play">
            {intl.formatMessage({
              id: 'landing.hero.playOnline',
              defaultMessage: 'Play online',
            })}
          </a>
          {/* Phones already get Watch in the fixed dock. */}
          <button type="button" className="lp-btn lp-btn-crowd-outline lp-btn-xl lp-hide-mobile" onClick={onWatch}>
            <CrowdIcon />
            {intl.formatMessage({
              id: 'landing.hero.watch',
              defaultMessage: 'Watch & join the crowd',
            })}
          </button>
        </div>
        <p className="lp-trust">
          {intl.formatMessage({
            id: 'landing.hero.trust',
            defaultMessage: 'Free. No account, no download. Bots fill empty seats, so a match starts in seconds.',
          })}
        </p>
      </div>
      <HeroCourt />
    </section>
  );
}

function HeroCourt() {
  const intl = useIntl();
  return (
    <div
      className="lp-hero-art"
      role="img"
      aria-label={intl.formatMessage({
        id: 'landing.hero.art.label',
        defaultMessage:
          'Illustration: Charmander and Pikachu for Team Ruby face Squirtle and Bulbasaur for Team Sapphire, whose crowd has called a Shield',
      })}
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
          <FormattedMessage
            id="landing.hero.art.callout"
            defaultMessage="Sapphire’s crowd called <shield>SHIELD</shield>!<mobileHidden> It lands in 2.</mobileHidden>"
            values={{
              shield: (chunks) => <strong className="lp-crowd-text">{chunks}</strong>,
              mobileHidden: (chunks) => <span className="lp-hide-mobile">{chunks}</span>,
            }}
          />
        </span>
      </div>
    </div>
  );
}
