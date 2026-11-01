import { memo, useEffect, useReducer, useState, type CSSProperties, type ReactNode } from 'react';
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
  CROWD_CARDS,
  SIDE_NAME,
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

  if (!teams) return <p style={{ ...noteStyle, padding: 16 }}>Crowd Calls are team modes only.</p>;

  const viewSide = side ?? picked;
  const nowMs = store?.getEngine().getState().elapsedMs ?? 0;
  const status = callStatus(current, nowMs);
  const callSide = current?.sides[viewSide] ?? null;
  const tally = callSide ? tallySide(callSide) : null;
  const voting = status.kind === 'voting';

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
          {current ? `CROWD CALL ${current.index}/${Math.max(CALLS_PER_MATCH, current.index)}` : 'CROWD CALL'}
        </span>
        <span style={{ fontSize: 13, color: INK_MUTED }}>
          {SIDE_NAME[viewSide]} crowd{tally ? ` · ${tally.total} vote${tally.total === 1 ? '' : 's'}` : ''}
        </span>
        <span style={clockStyle}>
          {status.kind === 'voting'
            ? formatClock(status.closesInS * 1000)
            : status.kind === 'landing'
              ? `lands ${status.landsInS}`
              : store
                ? `next ${formatClock(status.nextInMs)}`
                : ''}
        </span>
      </div>
      {voting && (
        <div style={barTrack(6)}>
          <div style={barFill(CROWD, status.left)} />
        </div>
      )}

      {fighter ? (
        <p style={noteStyle}>Fighters can’t vote — {side ? `the ${SIDE_NAME[side]} crowd` : 'your crowd'} votes for you.</p>
      ) : side ? (
        <div style={lockedRowStyle}>
          <span style={dot(side)} />
          <span>
            Cheering <strong style={{ color: side === 'teamA' ? TEAM_A_COLOR_CSS : TEAM_B_COLOR_CSS }}>{SIDE_NAME[side]}</strong> · locked
            for this match
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            role="group"
            aria-label="Cheer for"
            style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', alignItems: 'center', gap: 6 }}
          >
            <span style={labelStyle} aria-hidden>
              Cheer for
            </span>
            {(['teamA', 'teamB'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={picked === s}
                onClick={() => setPicked(s)}
                style={sideButton(s, picked === s, dense)}
              >
                {SIDE_NAME[s]}
              </button>
            ))}
          </div>
          <span style={noteStyle}>Your side locks once you vote or bet this match.</span>
        </div>
      )}

      {!current || !callSide || !tally ? (
        <p style={noteStyle}>
          {store
            ? `Next Crowd Call opens in ${formatClock(status.kind === 'waiting' ? status.nextInMs : 0)}.`
            : 'First Crowd Call opens 20 s into the match, then every 30 s. Voting stays open 10 s.'}
        </p>
      ) : (
        <>
          {!voting && callSide.winner && (
            <p style={{ margin: 0, fontFamily: FONT_UI, fontSize: 15 }}>
              {callSide.housePick ? 'House pick: ' : `${SIDE_NAME[viewSide]}'s crowd called `}
              <strong style={{ color: CROWD_TEXT }}>{CROWD_CARDS[callSide.winner].label}</strong>
              {status.kind === 'landing' ? ` — lands in ${status.landsInS}` : ' — landed'}
            </p>
          )}
          {voting && !fighter && (
            <span style={noteStyle}>{!signedUp ? 'Sign up to vote.' : myVote ? 'Tap another card to switch.' : 'Tap a card to vote.'}</span>
          )}
          {tally.cards.map((card) => {
            const mine = myVote === card.id; // stays set through landing
            const won = !voting && callSide.winner === card.id;
            const canVote = voting && signedUp && !fighter && !pending;
            const tag = pending === card.id ? 'SENDING' : won ? (callSide.housePick ? 'HOUSE' : 'WIN') : mine ? 'YOUR VOTE' : '';
            const { label, desc } = CROWD_CARDS[card.id];
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={mine}
                disabled={!canVote}
                onClick={() => vote(card.id)}
                aria-label={`${label}: ${desc}. ${card.pct}%${tag ? `, ${tag.toLowerCase()}` : ''}`}
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
      <span style={noteStyle}>Winner hits every {SIDE_NAME[viewSide]} fighter 2 s after voting. No votes → house pick.</span>
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
