import { KO_FI_URL, pokeballUrl } from './assets';
import { useScrollToTop } from './useScrollToTop';

/** The landing page's trust and legal surface: play money only and the
 * not-affiliated-with-Nintendo disclaimer. The PMDCollab sprite credit that
 * used to sit here was removed on purpose (2026-09-13). SpriteCollab is
 * licensed CC BY-NC 4.0, which requires attribution, so this is the place to
 * put it back if that changes. */
export function LandingFooter() {
  const scrollToTop = useScrollToTop();

  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div>
          <div className="lp-footer-brand">
            <img src={pokeballUrl} alt="" width={30} height={30} />
            <span>POKÉBETS ARENA</span>
          </div>
          <div className="lp-footer-copy">
            <p>
              A free, non-commercial fan project. Bets use play money only: it has no cash value and can’t be bought, sold
              or withdrawn.
            </p>
            <p>
              PokéBets Arena is not affiliated with, endorsed by or sponsored by Nintendo, The Pokémon Company or Game
              Freak. Pokémon and all related names are trademarks of their respective owners.
            </p>
          </div>
        </div>
        <nav aria-label="Footer">
          <ul className="lp-footer-links">
            <li>
              <a href="#/local">Solo Play</a>
            </li>
            <li>
              <a href={KO_FI_URL} target="_blank" rel="noopener noreferrer" aria-label="Support on Ko-fi (opens in a new tab)">
                Support on Ko-fi
              </a>
            </li>
            <li>
              <button type="button" onClick={scrollToTop}>
                Back to top
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
