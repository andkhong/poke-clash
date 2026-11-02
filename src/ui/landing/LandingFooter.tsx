import { useIntl } from 'react-intl';
import { KO_FI_URL } from './assets';

interface LandingFooterProps {
  /** Opens the contact modal, which LandingPage owns. */
  onContact: () => void;
  onBackToTop: () => void;
}

/** The trust and legal line (play money only, not affiliated, the
 * PMDCollab SpriteCollab credit that its CC BY-NC license asks for) and the
 * footer links. */
export function LandingFooter({ onContact, onBackToTop }: LandingFooterProps) {
  const intl = useIntl();
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <p className="lp-footer-copy">
          {intl.formatMessage({
            id: 'landing.footer.legal',
            defaultMessage:
              'Free, non-commercial fan project. Play money only, no cash value. Not affiliated with Nintendo, The Pokémon Company or Game Freak. Sprites by the PMDCollab SpriteCollab community (CC BY-NC).',
          })}
        </p>
        <nav
          aria-label={intl.formatMessage({
            id: 'landing.footer.navLabel',
            defaultMessage: 'Footer',
          })}
        >
          <ul className="lp-footer-links">
            <li>
              <a href="#/local">
                {intl.formatMessage({
                  id: 'landing.footer.playNow',
                  defaultMessage: 'Play now',
                })}
              </a>
            </li>
            <li>
              <a href="#/play">
                {intl.formatMessage({
                  id: 'landing.footer.playOnline',
                  defaultMessage: 'Play online',
                })}
              </a>
            </li>
            <li>
              <a
                href={KO_FI_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={intl.formatMessage({
                  id: 'landing.footer.kofiLabel',
                  defaultMessage: 'Support on Ko-fi (opens in a new tab)',
                })}
              >
                {intl.formatMessage({
                  id: 'landing.footer.kofi',
                  defaultMessage: 'Support on Ko-fi',
                })}
              </a>
            </li>
            <li>
              <button type="button" aria-haspopup="dialog" onClick={onContact}>
                {intl.formatMessage({
                  id: 'landing.footer.contact',
                  defaultMessage: 'Contact',
                })}
              </button>
            </li>
            <li>
              <button type="button" onClick={onBackToTop}>
                {intl.formatMessage({
                  id: 'landing.footer.backToTop',
                  defaultMessage: 'Back to top',
                })}
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
