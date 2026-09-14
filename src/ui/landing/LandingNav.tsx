import { KO_FI_URL, pokeballUrl } from './assets';
import { HeartIcon, MailIcon } from './icons';
import { useScrollToTop } from './useScrollToTop';

interface LandingNavProps {
  /** Opens the contact modal, which LandingScreen owns. */
  onContact: () => void;
}

/** The landing page's sticky top bar: brand mark on the left (it's already
 * the landing route, so a click scrolls to the top instead of navigating),
 * Solo Play, Contact me (opens ContactModal) and the Ko-fi link on the right.
 * On phones Solo Play is hidden — it's the hero's secondary CTA right below —
 * Contact me shows only from 900px up (below that the footer's Contact me
 * carries it), and the Ko-fi label shortens to SUPPORT, so the bar fits on
 * one 56px row at 375px. */
export function LandingNav({ onContact }: LandingNavProps) {
  const scrollToTop = useScrollToTop();

  return (
    <header className="lp-nav">
      <div className="lp-container lp-nav-inner">
        <a
          className="lp-brand"
          href="#/"
          aria-label="PokéBets Arena, back to top"
          onClick={(event) => {
            event.preventDefault();
            scrollToTop();
          }}
        >
          <img src={pokeballUrl} alt="" width={30} height={30} />
          <span className="lp-wordmark">POKÉBETS ARENA</span>
        </a>
        <nav aria-label="Main" className="lp-nav-actions">
          <a className="lp-btn lp-btn-ghost lp-hide-mobile" href="#/local">
            SOLO PLAY
          </a>
          <button type="button" className="lp-btn lp-btn-ghost lp-btn-contact" aria-haspopup="dialog" onClick={onContact}>
            <MailIcon />
            CONTACT ME
          </button>
          <a
            className="lp-btn lp-btn-support"
            href={KO_FI_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Support PokéBets Arena on Ko-fi (opens in a new tab)"
          >
            <HeartIcon />
            <span className="lp-hide-mobile">SUPPORT ON KO-FI</span>
            <span className="lp-only-mobile">SUPPORT</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
