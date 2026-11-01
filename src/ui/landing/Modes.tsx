/** The five Play Mode sizes (PLAY_MODES in app/playMode.ts, copied here so
 * the landing bundle skips the species dataset). Each opens the online room
 * list, where a room of that mode can be created. Footnote facts: KANTO_IDS,
 * ACTION_MATCH_LIMIT_MS (src/sim/action/rules.ts) and the one-KO rule (ActionEngine). */
const MODES = [
  { label: '1v1', blurb: 'Duel. Pure reads and dodges.' },
  { label: '2v2', blurb: 'Bring a friend or a bot.' },
  { label: '3v3', blurb: 'Room for a tank and a sniper.' },
  { label: '4v4', blurb: 'Full court, full chaos.' },
  { label: 'FFA', blurb: 'Up to 8, last one standing.' },
] as const;

export function Modes() {
  return (
    <section id="modes" className="lp-section lp-container" aria-labelledby="lp-modes-title">
      <h2 id="lp-modes-title" className="lp-h2">
        Modes
      </h2>
      <ul className="lp-modes" role="list">
        {MODES.map((mode) => (
          <li key={mode.label} className={mode.label === 'FFA' ? 'lp-mode-ffa' : undefined}>
            <a className="lp-mode" href="#/play">
              <span className="lp-mode-label">{mode.label}</span>
              <span className="lp-mode-blurb">{mode.blurb}</span>
              {mode.label === 'FFA' && <span className="lp-mode-blurb-short">up to 8</span>}
            </a>
          </li>
        ))}
      </ul>
      <p className="lp-note">Original 151 only. One KO and you're out, 3 minutes, WASD or touch joystick.</p>
    </section>
  );
}
