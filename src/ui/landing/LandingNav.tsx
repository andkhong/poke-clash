import { useState } from 'react';
import { pokeballUrl } from './assets';
import { MenuIcon, PlayIcon } from './icons';

const SECTIONS = [
  { id: 'rooms', label: 'Live rooms' },
  { id: 'crowd', label: 'How the crowd plays' },
  { id: 'modes', label: 'Modes' },
] as const;

interface LandingNavProps {
  /** Scrolls to a section by id, or to the top with none (see useScrollTo). */
  onScrollTo: (id?: string) => void;
  /** Opens the contact modal, which LandingPage owns. */
  onContact: () => void;
}

/** The sticky top bar: brand (scrolls to the top), the section links and
 * Play now. Below 900px the links fold into a menu button. */
export function LandingNav({ onScrollTo, onContact }: LandingNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const go = (id: string) => {
    setMenuOpen(false);
    onScrollTo(id);
  };

  return (
    <header className="lp-nav">
      <div className="lp-container lp-nav-inner">
        <a
          className="lp-brand"
          href="#/"
          aria-label="Pokémon Brawl, back to top"
          onClick={(event) => {
            event.preventDefault();
            onScrollTo();
          }}
        >
          <img src={pokeballUrl} alt="" width={32} height={32} />
          <span className="lp-wordmark">Pokémon Brawl</span>
        </a>
        <nav aria-label="Main" className="lp-nav-links">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="lp-nav-link" onClick={() => go(s.id)}>
              {s.label}
            </button>
          ))}
          <a className="lp-btn lp-btn-primary lp-btn-sm" href="#/local">
            <PlayIcon />
            Play now
          </a>
        </nav>
        <button
          type="button"
          className="lp-menu-btn"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="lp-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
      </div>
      {menuOpen && (
        <nav id="lp-menu" aria-label="Menu" className="lp-menu">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="lp-menu-item" onClick={() => go(s.id)}>
              {s.label}
            </button>
          ))}
          <a className="lp-menu-item" href="#/play">
            Play online
          </a>
          <button
            type="button"
            className="lp-menu-item"
            aria-haspopup="dialog"
            onClick={() => {
              setMenuOpen(false);
              onContact();
            }}
          >
            Contact
          </button>
        </nav>
      )}
    </header>
  );
}
