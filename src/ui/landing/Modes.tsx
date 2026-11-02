import { defineMessages, useIntl } from 'react-intl';

/** The five Play Mode sizes (PLAY_MODES in app/playMode.ts, copied here so
 * the landing bundle skips the species dataset). Each opens the online room
 * list, where a room of that mode can be created. Footnote facts: PLAY_IDS,
 * ACTION_MATCH_LIMIT_MS (src/sim/action/rules.ts) and the one-KO rule (ActionEngine). */
const blurbs = defineMessages({
  duel: {
    id: 'landing.modes.1v1',
    defaultMessage: 'Duel. Pure reads and dodges.',
  },
  two: { id: 'landing.modes.2v2', defaultMessage: 'Bring a friend or a bot.' },
  three: {
    id: 'landing.modes.3v3',
    defaultMessage: 'Room for a tank and a sniper.',
  },
  four: { id: 'landing.modes.4v4', defaultMessage: 'Full court, full chaos.' },
  ffa: {
    id: 'landing.modes.ffa',
    defaultMessage: 'Up to 8, last one standing.',
  },
});

const MODES = [
  { label: '1v1', blurb: blurbs.duel },
  { label: '2v2', blurb: blurbs.two },
  { label: '3v3', blurb: blurbs.three },
  { label: '4v4', blurb: blurbs.four },
  { label: 'Brawl', blurb: blurbs.ffa },
] as const;

export function Modes() {
  const intl = useIntl();
  return (
    <section id="modes" className="lp-section lp-container" aria-labelledby="lp-modes-title">
      <h2 id="lp-modes-title" className="lp-h2">
        {intl.formatMessage({
          id: 'landing.modes.title',
          defaultMessage: 'Modes',
        })}
      </h2>
      <ul className="lp-modes" role="list">
        {MODES.map((mode) => (
          <li key={mode.label} className={mode.label === 'Brawl' ? 'lp-mode-ffa' : undefined}>
            <a className="lp-mode" href="#/play">
              <span className="lp-mode-label">{mode.label}</span>
              <span className="lp-mode-blurb">{intl.formatMessage(mode.blurb)}</span>
              {mode.label === 'Brawl' && (
                <span className="lp-mode-blurb-short">
                  {intl.formatMessage({
                    id: 'landing.modes.ffaShort',
                    defaultMessage: 'up to 8',
                  })}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
      <p className="lp-note">
        {intl.formatMessage({
          id: 'landing.modes.note',
          defaultMessage: "Gens 1–4. One KO and you're out, 3 minutes, WASD or touch joystick.",
        })}
      </p>
    </section>
  );
}
