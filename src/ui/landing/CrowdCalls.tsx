import { FormattedMessage, defineMessages, useIntl } from 'react-intl';

/** "How the crowd plays": the Crowd Calls explainer. Every rule here is the
 * server's, so check it against src/net/play/playProtocol.ts before changing
 * either side: CROWD_CALL_EVERY_MS (30 s), CROWD_CALL_VOTE_MS (10 s), three
 * of the four cards per side, CROWD_CALL_LAND_DELAY_MS (2 s), a random house
 * pick when nobody votes, fighters never vote, the first vote or bet locks a
 * viewer's side, and team matches only (FFA has no calls yet). */
const STEPS = defineMessages({
  pick: {
    id: 'landing.crowd.step1.title',
    defaultMessage: 'Pick a name and a side',
  },
  pickBody: {
    id: 'landing.crowd.step1.body',
    defaultMessage: 'Type a display name, no account. Cheer for Ruby or Sapphire. Your bet, if you place one, goes on the same side.',
  },
  vote: {
    id: 'landing.crowd.step2.title',
    defaultMessage: 'Vote for 10 seconds',
  },
  voteBody: {
    id: 'landing.crowd.step2.body',
    defaultMessage: 'Three cards appear: Speed Burst, Shield, Energy Refill or Supply Drop. One vote each, live bars show the split.',
  },
  lands: {
    id: 'landing.crowd.step3.title',
    defaultMessage: 'It lands, with a warning',
  },
  landsBody: {
    id: 'landing.crowd.step3.body',
    defaultMessage: 'The winning card hits your side’s fighters 2 seconds after the window closes. Both teams see the countdown.',
  },
});

const STEP_LIST = [
  { title: STEPS.pick, body: STEPS.pickBody },
  { title: STEPS.vote, body: STEPS.voteBody },
  { title: STEPS.lands, body: STEPS.landsBody },
];

const RULES = defineMessages({
  same: {
    id: 'landing.crowd.rule.sameCard',
    defaultMessage: 'Big crowd or small, each side gets the same one card.',
  },
  house: {
    id: 'landing.crowd.rule.house',
    defaultMessage: 'No crowd yet? The house picks.',
  },
  chat: {
    id: 'landing.crowd.rule.fightersChat',
    defaultMessage: 'Fighters chat but never vote.',
  },
  teams: {
    id: 'landing.crowd.rule.teamMatches',
    defaultMessage: 'Crowd Calls run in team matches.',
  },
});

export function CrowdCalls() {
  const intl = useIntl();
  return (
    <section id="crowd" className="lp-band" aria-labelledby="lp-crowd-title">
      <div className="lp-container lp-band-inner">
        <div className="lp-band-head">
          <h2 id="lp-crowd-title" className="lp-h2">
            <FormattedMessage
              id="landing.crowd.title"
              defaultMessage="Every 30 seconds, the stands make a <call>Crowd Call</call>."
              values={{
                call: (chunks) => <span className="lp-crowd-text">{chunks}</span>,
              }}
            />
          </h2>
          <p className="lp-section-sub">
            {intl.formatMessage({
              id: 'landing.crowd.sub',
              defaultMessage:
                'Fighters keep full control of their Pokémon. The crowd decides what help arrives, and everyone can see it coming.',
            })}
          </p>
        </div>
        <ol className="lp-steps">
          {STEP_LIST.map((step, i) => (
            <li key={step.title.id} className="lp-step">
              <span className="lp-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <div className="lp-step-text">
                <h3 className="lp-h3">{intl.formatMessage(step.title)}</h3>
                <p className="lp-step-body">{intl.formatMessage(step.body)}</p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="lp-rules" role="list">
          {Object.values(RULES).map((rule) => (
            <li key={rule.id} className="lp-rule">
              {intl.formatMessage(rule)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
