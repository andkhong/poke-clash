import type { CSSProperties, ReactNode } from 'react';
import { CROWD_CALL_EVERY_MS, type CrowdCallView, type CrowdSide } from '../../net/play/playProtocol';
import { CROWD, FONT_BODY, FONT_UI, INK_MUTED, PANEL } from '../theme';
import { CROWD_CARDS, SIDE_NAME, callStatus, formatClock, otherSide, tallySide } from './crowdModel';
import { barFill, barTrack, chip, messageBox } from './hoenn';

/** How long a landed call stays up in the compact (phone) box. */
const COMPACT_LANDED_MS = 3000;

interface CrowdCallBannerProps {
  current: CrowdCallView | null;
  /** The match clock. */
  nowMs: number;
  /** The side this screen is on (a fighter's team or a viewer's locked side), else null. */
  myTeam: CrowdSide | null;
  /** Phones: one line, and only while a call is live or just landed. */
  compact?: boolean;
  style?: CSSProperties;
}

const card = (label: string) => <strong style={{ color: CROWD }}>{label}</strong>;

/** The battle message box that announces Crowd Calls: open → called → landed. */
export function CrowdCallBanner({ current, nowMs, myTeam, compact = false, style }: CrowdCallBannerProps) {
  const status = callStatus(current, nowMs);
  if (compact && (status.kind === 'waiting' || (status.kind === 'landed' && current && nowMs - current.landsAtMs > COMPACT_LANDED_MS)))
    return null;

  // The headline is the rival's call (what's coming at you); your own crowd's goes underneath.
  const lead: CrowdSide = myTeam ? otherSide(myTeam) : 'teamA';
  const mine = otherSide(lead);
  const mineChip = myTeam ? 'YOUR CROWD' : `${SIDE_NAME[mine].toUpperCase()} CROWD`;
  const sideCall = (side: CrowdSide) => current?.sides[side] ?? null;
  const winner = (side: CrowdSide) => sideCall(side)?.winner ?? null;

  let headline: ReactNode;
  let footer: ReactNode = null;
  let bar: number | null = null;

  if (status.kind === 'waiting') {
    headline = (
      <>
        The crowd is warming up. First {card('Crowd Call')} in {formatClock(status.nextInMs)}.
      </>
    );
  } else if (status.kind === 'voting') {
    headline = (
      <>
        A {card('Crowd Call')} is open! Both crowds are voting. Closes in {status.closesInS}.
      </>
    );
    const side = sideCall(mine);
    const leader = side ? tallySide(side).cards.find((c) => c.leading) : undefined;
    footer = leader ? `${SIDE_NAME[mine]} crowd leaning ${CROWD_CARDS[leader.id].name}` : `${SIDE_NAME[mine]} crowd hasn’t voted yet`;
    bar = status.left;
  } else {
    const leadWin = winner(lead);
    const verb = status.kind === 'landing' ? `Lands in ${status.landsInS}.` : 'Landed!';
    headline = leadWin ? (
      sideCall(lead)?.housePick ? (
        <>
          The house picked {card(CROWD_CARDS[leadWin].label)} for {SIDE_NAME[lead]}! {verb}
        </>
      ) : (
        <>
          {SIDE_NAME[lead]}’s crowd called {card(CROWD_CARDS[leadWin].label)}! {verb}
        </>
      )
    ) : (
      <>Voting closed. {verb}</>
    );
    const mineWin = winner(mine);
    const next = status.kind === 'landed' ? ` · next call in ${formatClock(status.nextInMs)}` : '';
    footer = mineWin
      ? `${sideCall(mine)?.housePick ? 'House pick: ' : ''}${CROWD_CARDS[mineWin].name} ${status.kind === 'landing' ? `lands in ${status.landsInS}` : 'landed'}${next}`
      : next.slice(3);
    if (status.kind === 'landed') bar = 1 - status.nextInMs / CROWD_CALL_EVERY_MS;
  }

  if (compact) {
    return (
      <div role="status" style={{ ...messageBox, padding: '8px 12px', fontFamily: FONT_UI, fontSize: 18, lineHeight: 1.25, ...style }}>
        {headline}
      </div>
    );
  }
  return (
    <div
      role="status"
      style={{
        ...messageBox,
        padding: '14px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 8,
        ...style,
      }}
    >
      <div style={{ fontFamily: FONT_UI, fontSize: 22, lineHeight: 1.3 }}>{headline}</div>
      {(footer || bar !== null) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: FONT_BODY, fontSize: 15, minWidth: 0 }}>
          {footer && <span style={chip(CROWD, PANEL)}>{mineChip}</span>}
          {footer && <span style={{ color: INK_MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{footer}</span>}
          {bar !== null && (
            <div style={{ ...barTrack(8), width: 120, flex: 'none', marginLeft: 'auto' }}>
              <div style={barFill(CROWD, bar)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
