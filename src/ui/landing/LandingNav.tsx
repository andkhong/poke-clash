import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { LOCALE_NAMES, LOCALES, setLocale, type Locale } from '../../i18n';
import { pokeballUrl } from './assets';
import { CheckIcon, ChevronIcon, GlobeIcon, MenuIcon, PlayIcon } from './icons';

const sectionLabels = defineMessages({
  rooms: { id: 'landing.nav.rooms', defaultMessage: 'Live rooms' },
  crowd: { id: 'landing.nav.crowd', defaultMessage: 'How the crowd plays' },
  modes: { id: 'landing.nav.modes', defaultMessage: 'Modes' },
});

const SECTIONS = (['rooms', 'crowd', 'modes'] as const).map((id) => ({
  id,
  label: sectionLabels[id],
}));

interface LandingNavProps {
  /** Scrolls to a section by id, or to the top with none (see useScrollTo). */
  onScrollTo: (id?: string) => void;
  /** Opens the contact modal, which LandingPage owns. */
  onContact: () => void;
}

/** The sticky top bar: brand (scrolls to the top), the section links and
 * Play now. Below 900px the links fold into a menu button. */
export function LandingNav({ onScrollTo, onContact }: LandingNavProps) {
  const intl = useIntl();
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
          aria-label={intl.formatMessage({
            id: 'landing.nav.brandLabel',
            defaultMessage: 'Pokémon Brawl, back to top',
          })}
          onClick={(event) => {
            event.preventDefault();
            onScrollTo();
          }}
        >
          <img src={pokeballUrl} alt="" width={32} height={32} />
          <span className="lp-wordmark">Pokémon Brawl</span>
        </a>
        <div className="lp-nav-end">
          <nav
            aria-label={intl.formatMessage({
              id: 'landing.nav.mainLabel',
              defaultMessage: 'Main',
            })}
            className="lp-nav-links"
          >
            {SECTIONS.map((s) => (
              <button key={s.id} type="button" className="lp-nav-link" onClick={() => go(s.id)}>
                {intl.formatMessage(s.label)}
              </button>
            ))}
            <a className="lp-btn lp-btn-primary lp-btn-sm" href="#/local">
              <PlayIcon />
              {intl.formatMessage({
                id: 'landing.nav.playNow',
                defaultMessage: 'Play now',
              })}
            </a>
          </nav>
          <button
            type="button"
            className="lp-menu-btn"
            aria-label={intl.formatMessage({
              id: 'landing.nav.menu',
              defaultMessage: 'Menu',
            })}
            aria-expanded={menuOpen}
            aria-controls="lp-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon />
          </button>
          <LanguagePicker />
        </div>
      </div>
      {menuOpen && (
        <nav
          id="lp-menu"
          aria-label={intl.formatMessage({
            id: 'landing.nav.menu',
            defaultMessage: 'Menu',
          })}
          className="lp-menu"
        >
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="lp-menu-item" onClick={() => go(s.id)}>
              {intl.formatMessage(s.label)}
            </button>
          ))}
          <a className="lp-menu-item" href="#/play">
            {intl.formatMessage({
              id: 'landing.nav.playOnline',
              defaultMessage: 'Play online',
            })}
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
            {intl.formatMessage({
              id: 'landing.nav.contact',
              defaultMessage: 'Contact',
            })}
          </button>
          <LanguagePicker />
        </nav>
      )}
    </header>
  );
}

/** Native select of the supported languages, each in its own name; picking one reloads the page in it. */
function LanguagePicker() {
  const intl = useIntl();
  const current = intl.locale as Locale;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = intl.formatMessage({ id: 'landing.nav.language', defaultMessage: 'Language' });

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Menu keys: arrows move between languages, Escape closes and returns focus to the button.
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    } else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className="lp-lang" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="lp-lang-btn"
        aria-label={`${label}: ${LOCALE_NAMES[current]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <GlobeIcon />
        <span lang={current}>{LOCALE_NAMES[current]}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={label} className="lp-lang-menu" onKeyDown={onMenuKeyDown}>
          {LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              role="menuitemradio"
              aria-checked={locale === current}
              lang={locale}
              className="lp-lang-item"
              onClick={() => (locale === current ? setOpen(false) : setLocale(locale))}
            >
              {LOCALE_NAMES[locale]}
              {locale === current && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
