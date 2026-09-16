/** The three-step explainer between the featured room and the grid. Every
 * number in it is a live game rule, so check it against the code before
 * changing either side:
 * - "Up to 8": the showcase room's `capacity: 8` (game-server/server.ts).
 * - "two minutes": MATCH_TIME_LIMIT_MS (sim/constants.ts), a hard cap.
 * - "first 45 seconds": AGGRESSION_TRIGGER_MS, when the prediction pool
 *   closes (game-server/predictions.ts). The match clock counts *down* from
 *   2:00, so the copy never says "at 0:45".
 * - "$10": MATCH_WATCHED_REWARD (game-server/wallets.ts). The $100 in the
 *   hero is STARTING_BALANCE, from the same file. */
const STEPS = [
  {
    num: '01',
    title: 'Pick a room',
    body: 'Open any showcase room or grab a seat in a live one. No sign-up, no download, nothing to install.',
  },
  {
    num: '02',
    title: 'Watch the brawl',
    body: 'Up to 8 Pokémon fight it out on their own. Every battle wraps up in two minutes or less.',
  },
  {
    num: '03',
    title: 'Bet play money',
    body: 'Back a fighter in the first 45 seconds. If it wins, you split the pot, and every match you watch adds $10 to your wallet.',
  },
] as const;

export function HowItWorks() {
  return (
    <section className="lp-section" aria-labelledby="lp-how-title">
      <div className="lp-section-head">
        <h2 id="lp-how-title" className="lp-h2">
          HOW IT WORKS
        </h2>
      </div>
      <ol className="lp-steps">
        {STEPS.map((step) => (
          <li key={step.num} className="lp-step">
            <span className="lp-step-num" aria-hidden="true">
              {step.num}
            </span>
            <h3 className="lp-step-title">{step.title}</h3>
            <p className="lp-step-body">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
