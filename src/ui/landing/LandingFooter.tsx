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
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <p className="lp-footer-copy">
          Free, non-commercial fan project. Play money only, no cash value. Not affiliated with Nintendo, The Pokémon Company or Game Freak.
          Sprites by the PMDCollab SpriteCollab community (CC BY-NC).
        </p>
        <nav aria-label="Footer">
          <ul className="lp-footer-links">
            <li>
              <a href="#/local">Play now</a>
            </li>
            <li>
              <a href="#/play">Play online</a>
            </li>
            <li>
              <a href={KO_FI_URL} target="_blank" rel="noopener noreferrer" aria-label="Support on Ko-fi (opens in a new tab)">
                Support on Ko-fi
              </a>
            </li>
            <li>
              <button type="button" aria-haspopup="dialog" onClick={onContact}>
                Contact
              </button>
            </li>
            <li>
              <button type="button" onClick={onBackToTop}>
                Back to top
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
