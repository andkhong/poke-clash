/** "How the crowd plays": the Crowd Calls explainer. Every rule here is the
 * server's, so check it against src/net/play/playProtocol.ts before changing
 * either side: CROWD_CALL_EVERY_MS (30 s), CROWD_CALL_VOTE_MS (10 s), three
 * of the four cards per side, CROWD_CALL_LAND_DELAY_MS (2 s), a random house
 * pick when nobody votes, fighters never vote, the first vote or bet locks a
 * viewer's side, and team matches only (FFA has no calls yet). */
const STEPS = [
  {
    title: 'Pick a name and a side',
    body: 'Type a display name, no account. Cheer for Ruby or Sapphire. Your bet, if you place one, goes on the same side.',
  },
  {
    title: 'Vote for 10 seconds',
    body: 'Three cards appear: Speed Burst, Shield, Energy Refill or Supply Drop. One vote each, live bars show the split.',
  },
  {
    title: 'It lands, with a warning',
    body: 'The winning card hits your side’s fighters 2 seconds after the window closes. Both teams see the countdown.',
  },
] as const;

const RULES = [
  'Big crowd or small, each side gets the same one card.',
  'No crowd yet? The house picks.',
  'Fighters chat but never vote.',
  'Crowd Calls run in team matches.',
] as const;

export function CrowdCalls() {
  return (
    <section id="crowd" className="lp-band" aria-labelledby="lp-crowd-title">
      <div className="lp-container lp-band-inner">
        <div className="lp-band-head">
          <h2 id="lp-crowd-title" className="lp-h2">
            Every 30 seconds, the stands make a <span className="lp-crowd-text">Crowd Call</span>.
          </h2>
          <p className="lp-section-sub">
            Fighters keep full control of their Pokémon. The crowd decides what help arrives, and everyone can see it coming.
          </p>
        </div>
        <ol className="lp-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="lp-step">
              <span className="lp-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="lp-step-text">
                <h3 className="lp-h3">{step.title}</h3>
                <p className="lp-step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="lp-rules" role="list">
          {RULES.map((rule) => (
            <li key={rule} className="lp-rule">
              {rule}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
