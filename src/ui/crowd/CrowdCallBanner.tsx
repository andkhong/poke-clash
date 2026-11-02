import { FormattedMessage, useIntl } from 'react-intl';
import type { CSSProperties, ReactNode } from 'react';
import { CROWD_CALL_EVERY_MS, type CrowdCallView, type CrowdSide } from '../../net/play/playProtocol';
import { CROWD, FONT_BODY, FONT_UI, INK_MUTED, PANEL, CROWD_TEXT } from '../theme';
import { cardText, sideName, callStatus, formatClock, otherSide, tallySide } from './crowdModel';
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

const b = (label: ReactNode) => <strong style={{ color: CROWD_TEXT }}>{label}</strong>;

/** The battle message box that announces Crowd Calls: open → called → landed. */
export function CrowdCallBanner({ current, nowMs, myTeam, compact = false, style }: CrowdCallBannerProps) {
  const intl = useIntl();
  const status = callStatus(current, nowMs);
  if (compact && (status.kind === 'waiting' || (status.kind === 'landed' && current && nowMs - current.landsAtMs > COMPACT_LANDED_MS)))
    return null;

  // The headline is the rival's call (what's coming at you); your own crowd's goes underneath.
  const lead: CrowdSide = myTeam ? otherSide(myTeam) : 'teamA';
  const mine = otherSide(lead);
  const mineChip = myTeam
    ? intl.formatMessage({ id: 'crowd.banner.yourCrowd', defaultMessage: 'YOUR CROWD' })
    : intl.formatMessage({ id: 'crowd.banner.sideCrowd', defaultMessage: '{side} CROWD' }, { side: sideName(mine).toLocaleUpperCase(intl.locale) });
  const sideCall = (side: CrowdSide) => current?.sides[side] ?? null;
  const winner = (side: CrowdSide) => sideCall(side)?.winner ?? null;

  let headline: ReactNode;
  let footer: ReactNode = null;
  let bar: number | null = null;

  if (status.kind === 'waiting') {
    headline = (
      <FormattedMessage
        id="crowd.banner.warmingUp"
        defaultMessage="The crowd is warming up. First <b>Crowd Call</b> in {clock}."
        values={{ b, clock: formatClock(status.nextInMs) }}
      />
    );
  } else if (status.kind === 'voting') {
    headline = (
      <FormattedMessage
        id="crowd.banner.open"
        defaultMessage="A <b>Crowd Call</b> is open! Both crowds are voting. Closes in {seconds}."
        values={{ b, seconds: status.closesInS }}
      />
    );
    const side = sideCall(mine);
    const leader = side ? tallySide(side).cards.find((c) => c.leading) : undefined;
    footer = leader
      ? intl.formatMessage(
          { id: 'crowd.banner.leaning', defaultMessage: '{side} crowd leaning {card}' },
          { side: sideName(mine), card: cardText(leader.id).name }
        )
      : intl.formatMessage({ id: 'crowd.banner.noVotes', defaultMessage: '{side} crowd hasn’t voted yet' }, { side: sideName(mine) });
    bar = status.left;
  } else {
    const leadWin = winner(lead);
    const phase = status.kind;
    const seconds = status.kind === 'landing' ? status.landsInS : 0;
    headline = leadWin ? (
      sideCall(lead)?.housePick ? (
        <FormattedMessage
          id="crowd.banner.housePicked"
          defaultMessage="The house picked <b>{card}</b> for {side}! {phase, select, landing {Lands in {seconds}.} other {Landed!}}"
          values={{ b, card: cardText(leadWin).label, side: sideName(lead), phase, seconds }}
        />
      ) : (
        <FormattedMessage
          id="crowd.banner.called"
          defaultMessage="{side}’s crowd called <b>{card}</b>! {phase, select, landing {Lands in {seconds}.} other {Landed!}}"
          values={{ b, card: cardText(leadWin).label, side: sideName(lead), phase, seconds }}
        />
      )
    ) : (
      <FormattedMessage
        id="crowd.banner.closed"
        defaultMessage="Voting closed. {phase, select, landing {Lands in {seconds}.} other {Landed!}}"
        values={{ phase, seconds }}
      />
    );
    const mineWin = winner(mine);
    const landed = status.kind === 'landed';
    const clock = landed ? formatClock(status.nextInMs) : '';
    footer = mineWin
      ? intl.formatMessage(
          {
            id: 'crowd.banner.footerResult',
            defaultMessage:
              '{house, select, yes {House pick: {card}} other {{card}}} {phase, select, landing {lands in {seconds}} other {landed}}{next, select, yes { · next call in {clock}} other {}}',
          },
          { house: sideCall(mine)?.housePick ? 'yes' : 'no', card: cardText(mineWin).name, phase, seconds, next: landed ? 'yes' : 'no', clock }
        )
      : landed
        ? intl.formatMessage({ id: 'crowd.banner.nextCall', defaultMessage: 'next call in {clock}' }, { clock })
        : null;
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
            <div style={{ ...barTrack(8), flex: '0 1 120px', minWidth: 48, marginLeft: 'auto' }}>
              <div style={barFill(CROWD, bar)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
