import { memo, useEffect, useReducer, useState, type CSSProperties, type ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { CrowdCardId, CrowdSide } from '../../net/play/playProtocol';
import { ACTION_MATCH_LIMIT_MS } from '../../sim/action/rules';
import type { SimStore } from '../state/simStore';
import {
  CROWD,
  CROWD_TINT,
  FONT_BODY,
  FONT_PIXEL,
  FONT_UI,
  INFO_BOX,
  INK,
  INK_MUTED,
  PANEL,
  RUBY,
  SAPPHIRE,
  SUNK,
  COOLDOWN,
  CROWD_TEXT,
} from '../theme';
import { TEAM_A_COLOR_CSS, TEAM_B_COLOR_CSS } from '../teamColors';
import {
  cardText,
  sideName,
  callStatus,
  callsPerMatch,
  formatClock,
  tallySide,
  useCrowdCalls,
  voteErrorText,
  type CrowdCallsStore,
} from './crowdModel';
import { barFill, barTrack, chip, tapHeight } from './hoenn';
import { CrowdCardIcon } from './CrowdCardIcon';

const ERROR_SHOW_MS = 2500;
/** The clock text only needs whole seconds; the 4 Hz `calls` updates cover voting. */
const TICK_MS = 500;
const CALLS_PER_MATCH = callsPerMatch(ACTION_MATCH_LIMIT_MS);

export interface CrowdCallPanelProps {
  calls: CrowdCallsStore;
  /** The running match (its clock drives the countdowns); null in the lobby. */
  store: SimStore | null;
  /** False in free-for-all: no sides, no calls. */
  teams: boolean;
  /** The side this viewer is locked to (from `me`), or a fighter's own team. */
  side: CrowdSide | null;
  myVote: CrowdCardId | null;
  signedUp: boolean;
  /** Seated fighters see their crowd's call but can't vote. */
  fighter: boolean;
  onVote: (side: CrowdSide, card: CrowdCardId) => Promise<string | null>;
  /** Shown above the cards until signedUp. */
  signUp?: ReactNode;
  /** Desktop sidebar density: 36 px controls instead of 44 px touch targets. */
  dense?: boolean;
}

/** The crowd's Vote tab: side picker, the open call's cards with live %, and
 * the countdown. Memoized: it reads the calls store itself, so neither the
 * 10 Hz HUD nor the 4 Hz vote updates re-render the chat beside it. */
export const CrowdCallPanel = memo(function CrowdCallPanel({
  calls,
  store,
  teams,
  side,
  myVote,
  signedUp,
  fighter,
  onVote,
  signUp,
  dense = false,
}: CrowdCallPanelProps) {
  const { current } = useCrowdCalls(calls);
  const [picked, setPicked] = useState<CrowdSide>('teamA');
  const [pending, setPending] = useState<CrowdCardId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const intl = useIntl();

  useEffect(() => {
    if (!store) return;
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [store]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), ERROR_SHOW_MS);
    return () => clearTimeout(timer);
  }, [error]);

  // No calls in a Brawl, but this tab is still where watchers sign up and queue for the next match.
  if (!teams) {
    return (
      <div style={wrapStyle}>
        {!fighter && signUp}
        <p style={{ ...noteStyle, padding: '6px 6px 0' }}>{intl.formatMessage({ id: 'crowd.panel.teamsOnly', defaultMessage: 'Crowd Calls are team modes only.' })}</p>
      </div>
    );
  }

  const viewSide = side ?? picked;
  const nowMs = store?.getEngine().getState().elapsedMs ?? 0;
  const status = callStatus(current, nowMs);
  const callSide = current?.sides[viewSide] ?? null;
  const tally = callSide ? tallySide(callSide) : null;
  const voting = status.kind === 'voting';
  const callValues = callSide?.winner
    ? {
        side: sideName(viewSide),
        card: cardText(callSide.winner).label,
        phase: status.kind,
        seconds: status.kind === 'landing' ? status.landsInS : 0,
        b: (c: ReactNode) => <strong style={{ color: CROWD_TEXT }}>{c}</strong>,
      }
    : null;
  const cheerFor = intl.formatMessage({ id: 'crowd.panel.cheerFor', defaultMessage: 'Cheer for' });

  const vote = (card: CrowdCardId) => {
    if (pending) return;
    setPending(card);
    void onVote(viewSide, card).then((code) => {
      setPending(null);
      if (code) setError(voteErrorText(code, side));
    });
  };

  return (
    <div style={wrapStyle}>
      {/* Until signed up the form comes first; after, the slim "signed up as" row and Join next match sink below the call. */}
      {!fighter && !signedUp && signUp}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={chip(CROWD_TEXT, PANEL)}>
          {current
            ? intl.formatMessage(
                { id: 'crowd.panel.callCounter', defaultMessage: 'CROWD CALL {index}/{total}' },
                { index: current.index, total: Math.max(CALLS_PER_MATCH, current.index) }
              )
            : intl.formatMessage({ id: 'crowd.panel.call', defaultMessage: 'CROWD CALL' })}
        </span>
        <span style={{ fontSize: 13, color: INK_MUTED }}>
          {tally
            ? intl.formatMessage(
                {
                  id: 'crowd.panel.crowdVotes',
                  defaultMessage: '{side} crowd · {total, plural, one {# vote} other {# votes}}',
                },
                { side: sideName(viewSide), total: tally.total }
              )
            : intl.formatMessage({ id: 'crowd.panel.crowd', defaultMessage: '{side} crowd' }, { side: sideName(viewSide) })}
        </span>
        <span style={clockStyle}>
          {status.kind === 'voting'
            ? formatClock(status.closesInS * 1000)
            : status.kind === 'landing'
              ? intl.formatMessage({ id: 'crowd.panel.clockLands', defaultMessage: 'lands {seconds}' }, { seconds: status.landsInS })
              : store
                ? intl.formatMessage({ id: 'crowd.panel.clockNext', defaultMessage: 'next {clock}' }, { clock: formatClock(status.nextInMs) })
                : ''}
        </span>
      </div>
      {voting && (
        <div style={barTrack(6)}>
          <div style={barFill(CROWD, status.left)} />
        </div>
      )}

      {fighter ? (
        <p style={noteStyle}>
          {side
            ? intl.formatMessage(
                { id: 'crowd.panel.fightersCantSide', defaultMessage: 'Fighters can’t vote — the {side} crowd votes for you.' },
                { side: sideName(side) }
              )
            : intl.formatMessage({ id: 'crowd.panel.fightersCant', defaultMessage: 'Fighters can’t vote — your crowd votes for you.' })}
        </p>
      ) : side ? (
        <div style={lockedRowStyle}>
          <span style={dot(side)} />
          <span>
            <FormattedMessage
              id="crowd.panel.cheering"
              defaultMessage="Cheering <b>{side}</b> · locked for this match"
              values={{
                side: sideName(side),
                b: (c) => <strong style={{ color: side === 'teamA' ? TEAM_A_COLOR_CSS : TEAM_B_COLOR_CSS }}>{c}</strong>,
              }}
            />
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            role="group"
            aria-label={cheerFor}
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', alignItems: 'center', gap: 6 }}
          >
            <span style={labelStyle} aria-hidden>
              {cheerFor}
            </span>
            {(['teamA', 'teamB'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={picked === s}
                onClick={() => setPicked(s)}
                style={sideButton(s, picked === s, dense)}
              >
                {sideName(s)}
              </button>
            ))}
          </div>
          <span style={noteStyle}>{intl.formatMessage({ id: 'crowd.panel.sideLocks', defaultMessage: 'Your side locks once you vote or bet this match.' })}</span>
        </div>
      )}

      {!current || !callSide || !tally ? (
        <p style={noteStyle}>
          {store
            ? intl.formatMessage(
                { id: 'crowd.panel.nextOpens', defaultMessage: 'Next Crowd Call opens in {clock}.' },
                { clock: formatClock(status.kind === 'waiting' ? status.nextInMs : 0) }
              )
            : intl.formatMessage({
                id: 'crowd.panel.schedule',
                defaultMessage: 'First Crowd Call opens 20 s into the match, then every 30 s. Voting stays open 10 s.',
              })}
        </p>
      ) : (
        <>
          {!voting && callSide.winner && callValues && (
            <p style={{ margin: 0, fontFamily: FONT_UI, fontSize: 15 }}>
              {callSide.housePick ? (
                <FormattedMessage
                  id="crowd.panel.housePicked"
                  defaultMessage="House pick: <b>{card}</b>{phase, select, landing { — lands in {seconds}} other { — landed}}"
                  values={callValues}
                />
              ) : (
                <FormattedMessage
                  id="crowd.panel.crowdCalled"
                  defaultMessage="{side}'s crowd called <b>{card}</b>{phase, select, landing { — lands in {seconds}} other { — landed}}"
                  values={callValues}
                />
              )}
            </p>
          )}
          {voting && !fighter && (
            <span style={noteStyle}>{!signedUp
                ? intl.formatMessage({ id: 'crowd.panel.signUpToVote', defaultMessage: 'Sign up to vote.' })
                : myVote
                  ? intl.formatMessage({ id: 'crowd.panel.tapToSwitch', defaultMessage: 'Tap another card to switch.' })
                  : intl.formatMessage({ id: 'crowd.panel.tapToVote', defaultMessage: 'Tap a card to vote.' })}</span>
          )}
          {tally.cards.map((card) => {
            const mine = myVote === card.id; // stays set through landing
            const won = !voting && callSide.winner === card.id;
            const canVote = voting && signedUp && !fighter && !pending;
            const tag =
              pending === card.id
                ? intl.formatMessage({ id: 'crowd.panel.tag.sending', defaultMessage: 'SENDING' })
                : won
                  ? callSide.housePick
                    ? intl.formatMessage({ id: 'crowd.panel.tag.house', defaultMessage: 'HOUSE' })
                    : intl.formatMessage({ id: 'crowd.panel.tag.win', defaultMessage: 'WIN' })
                  : mine
                    ? intl.formatMessage({ id: 'crowd.panel.tag.yourVote', defaultMessage: 'YOUR VOTE' })
                    : '';
            const { label, desc } = cardText(card.id);
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={mine}
                disabled={!canVote}
                onClick={() => vote(card.id)}
                aria-label={
                  tag
                    ? intl.formatMessage(
                        { id: 'crowd.panel.cardAriaTagged', defaultMessage: '{label}: {desc}. {pct}%, {tag}' },
                        { label, desc, pct: card.pct, tag: tag.toLocaleLowerCase(intl.locale) }
                      )
                    : intl.formatMessage({ id: 'crowd.panel.cardAria', defaultMessage: '{label}: {desc}. {pct}%' }, { label, desc, pct: card.pct })
                }
                title={desc}
                style={cardStyle(mine || won, canVote, dense)}
              >
                <span style={iconTile}>
                  <CrowdCardIcon card={card.id} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong style={{ fontFamily: FONT_UI, fontSize: 15, whiteSpace: 'nowrap' }}>{label}</strong>
                    {tag && <span style={tagStyle}>{tag}</span>}
                  </span>
                  <span style={descStyle}>{desc}</span>
                </span>
                <span style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{card.pct}%</span>
                {/* Vote share as a thin strip along the row's bottom edge, like the shop's stock bar. */}
                <span style={shareTrack} aria-hidden>
                  <span style={barFill(card.leading ? CROWD : COOLDOWN, card.pct / 100)} />
                </span>
              </button>
            );
          })}
        </>
      )}
      {error && (
        <p role="alert" style={{ ...noteStyle, color: RUBY, fontWeight: 700 }}>
          {error}
        </p>
      )}
      <span style={noteStyle}>{intl.formatMessage(
          { id: 'crowd.panel.winnerHits', defaultMessage: 'Winner hits every {side} fighter 2 s after voting. No votes → house pick.' },
          { side: sideName(viewSide) }
        )}
      </span>
      {!fighter && signedUp && signUp}
    </div>
  );
});

const wrapStyle: CSSProperties = {
  padding: '8px 10px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontFamily: FONT_BODY,
  color: INK,
};
const noteStyle: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.35, color: INK_MUTED };
const descStyle: CSSProperties = { fontSize: 12, color: INK_MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
// PANEL on CROWD_TEXT (8.8:1) — CROWD_TEXT straight on the CROWD_TINT row would fall short of 4.5:1.
const tagStyle: CSSProperties = {
  padding: '0 4px',
  borderRadius: 3,
  fontSize: 10,
  fontWeight: 700,
  color: PANEL,
  background: CROWD_TEXT,
  whiteSpace: 'nowrap',
};
const shareTrack: CSSProperties = { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: SUNK };
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 700 };
const clockStyle: CSSProperties = { marginLeft: 'auto', fontFamily: FONT_PIXEL, fontSize: 12, color: CROWD_TEXT, whiteSpace: 'nowrap' };
const lockedRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 8,
  border: `2px solid ${INK}`,
  background: INFO_BOX,
  fontSize: 13,
};
const iconTile: CSSProperties = {
  width: 28,
  height: 28,
  flex: 'none',
  borderRadius: 6,
  border: `2px solid ${INK}`,
  background: INFO_BOX,
  display: 'grid',
  placeItems: 'center',
};

function dot(side: CrowdSide): CSSProperties {
  return {
    width: 12,
    height: 12,
    flex: 'none',
    borderRadius: '50%',
    border: `2px solid ${INK}`,
    background: side === 'teamA' ? RUBY : SAPPHIRE,
  };
}

function sideButton(side: CrowdSide, on: boolean, dense: boolean): CSSProperties {
  return {
    minHeight: tapHeight(dense),
    borderRadius: 8,
    border: `${dense ? 2 : 3}px solid ${INK}`,
    fontFamily: FONT_UI,
    fontWeight: 700,
    fontSize: 16,
    cursor: 'pointer',
    background: on ? (side === 'teamA' ? RUBY : SAPPHIRE) : PANEL,
    color: on && side === 'teamA' ? PANEL : INK,
  };
}

function cardStyle(marked: boolean, enabled: boolean, dense: boolean): CSSProperties {
  return {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    minHeight: dense ? 44 : 52,
    padding: '4px 10px 8px 6px',
    borderRadius: 8,
    border: `2px solid ${INK}`,
    textAlign: 'left',
    fontFamily: FONT_BODY,
    color: INK,
    background: marked ? CROWD_TINT : PANEL,
    boxShadow: marked ? `inset 0 0 0 2px ${CROWD}` : 'none',
    cursor: enabled ? 'pointer' : 'default',
    overflow: 'hidden',
  };
}
