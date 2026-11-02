import { useSyncExternalStore } from 'react';
import { defineMessages } from 'react-intl';
import { intl } from '../../i18n';
import {
  CROWD_CALL_EVERY_MS,
  CROWD_CALL_FIRST_MS,
  CROWD_CALL_LAND_DELAY_MS,
  CROWD_CALL_VOTE_MS,
  type CrowdCallSide,
  type CrowdCallView,
  type CrowdCardId,
  type CrowdSide,
} from '../../net/play/playProtocol';

// Crowd Calls' pure helpers: card wording, vote percentages and the
// countdowns the panel, the message box and the results timeline share.

const CARD_MESSAGES = defineMessages({
  speedLabel: { id: 'crowd.card.speed.label', defaultMessage: 'SPEED BURST' },
  speedName: { id: 'crowd.card.speed.name', defaultMessage: 'Speed Burst' },
  speedDesc: { id: 'crowd.card.speed.desc', defaultMessage: '+30% move speed for 4 s' },
  shieldLabel: { id: 'crowd.card.shield.label', defaultMessage: 'SHIELD' },
  shieldName: { id: 'crowd.card.shield.name', defaultMessage: 'Shield' },
  shieldDesc: { id: 'crowd.card.shield.desc', defaultMessage: 'Blocks the next hit, up to 3 s' },
  energyLabel: { id: 'crowd.card.energy.label', defaultMessage: 'ENERGY REFILL' },
  energyName: { id: 'crowd.card.energy.name', defaultMessage: 'Energy Refill' },
  energyDesc: { id: 'crowd.card.energy.desc', defaultMessage: 'Full energy, right now' },
  supplyLabel: { id: 'crowd.card.supply.label', defaultMessage: 'SUPPLY DROP' },
  supplyName: { id: 'crowd.card.supply.name', defaultMessage: 'Supply Drop' },
  supplyDesc: { id: 'crowd.card.supply.desc', defaultMessage: 'A crate on their half heals +25%' },
});

/** A card's wording in the active language (call at render time). */
export function cardText(id: CrowdCardId): { label: string; name: string; desc: string } {
  return {
    label: intl.formatMessage(CARD_MESSAGES[`${id}Label`]),
    name: intl.formatMessage(CARD_MESSAGES[`${id}Name`]),
    desc: intl.formatMessage(CARD_MESSAGES[`${id}Desc`]),
  };
}

const SIDE_MESSAGES = defineMessages({
  teamA: { id: 'crowd.side.teamA', defaultMessage: 'Ruby' },
  teamB: { id: 'crowd.side.teamB', defaultMessage: 'Sapphire' },
});

export const sideName = (side: CrowdSide): string => intl.formatMessage(SIDE_MESSAGES[side]);
export const CROWD_SIDES: CrowdSide[] = ['teamA', 'teamB'];

export const otherSide = (side: CrowdSide): CrowdSide => (side === 'teamA' ? 'teamB' : 'teamA');

export function isCrowdSide(team: string | undefined | null): team is CrowdSide {
  return team === 'teamA' || team === 'teamB';
}

export interface CardTally {
  id: CrowdCardId;
  votes: number;
  /** Whole percent of this side's votes; 0 for every card while nobody has voted. */
  pct: number;
  /** Has the most votes (ties all lead); nobody leads at zero votes. */
  leading: boolean;
}

export function tallySide(side: CrowdCallSide): { total: number; cards: CardTally[] } {
  const counts = side.cards.map((id) => side.votes[id] ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const top = Math.max(0, ...counts);
  return {
    total,
    cards: side.cards.map((id, i) => ({
      id,
      votes: counts[i],
      pct: total > 0 ? Math.round((counts[i] / total) * 100) : 0,
      leading: top > 0 && counts[i] === top,
    })),
  };
}

/** Whole seconds until `atMs` on the match clock, never negative. */
export const secondsUntil = (atMs: number, nowMs: number) => Math.max(0, Math.ceil((atMs - nowMs) / 1000));

/** `m:ss`. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** When the next call opens: the first at CROWD_CALL_FIRST_MS, then every CROWD_CALL_EVERY_MS. */
export const nextCallAtMs = (current: CrowdCallView | null) => (current ? current.opensAtMs + CROWD_CALL_EVERY_MS : CROWD_CALL_FIRST_MS);

/** How many calls can land in a match of `limitMs` (a call needs its vote window and landing delay). */
export const callsPerMatch = (limitMs: number) =>
  Math.max(0, Math.floor((limitMs - CROWD_CALL_FIRST_MS - CROWD_CALL_VOTE_MS - CROWD_CALL_LAND_DELAY_MS) / CROWD_CALL_EVERY_MS) + 1);

export type CallStatus =
  | { kind: 'waiting'; nextInMs: number }
  | { kind: 'voting'; closesInS: number; /** Share of the vote window left, 1 → 0. */ left: number }
  | { kind: 'landing'; landsInS: number }
  | { kind: 'landed'; nextInMs: number };

/** Where the call cycle is, from the server's phase and the match clock. */
export function callStatus(current: CrowdCallView | null, nowMs: number): CallStatus {
  if (!current) return { kind: 'waiting', nextInMs: Math.max(0, CROWD_CALL_FIRST_MS - nowMs) };
  if (current.phase === 'voting') {
    const span = current.closesAtMs - current.opensAtMs || CROWD_CALL_VOTE_MS;
    return {
      kind: 'voting',
      closesInS: secondsUntil(current.closesAtMs, nowMs),
      left: Math.max(0, Math.min(1, (current.closesAtMs - nowMs) / span)),
    };
  }
  if (current.phase === 'landing') return { kind: 'landing', landsInS: secondsUntil(current.landsAtMs, nowMs) };
  return { kind: 'landed', nextInMs: Math.max(0, nextCallAtMs(current) - nowMs) };
}

/** A side's result as the timeline shows it: "Shield", or "House pick: Shield". */
export function winnerLabel(side: CrowdCallSide): string | null {
  if (!side.winner) return null;
  const { name } = cardText(side.winner);
  return side.housePick ? intl.formatMessage({ id: 'crowd.winner.housePick', defaultMessage: 'House pick: {card}' }, { card: name }) : name;
}

/** Wording for the vote request's error codes. */
export function voteErrorText(code: string, side: CrowdSide | null): string {
  switch (code) {
    case 'side_locked':
      return side
        ? intl.formatMessage({ id: 'crowd.voteError.sideLockedTo', defaultMessage: "You're cheering for {side} this match" }, { side: sideName(side) })
        : intl.formatMessage({ id: 'crowd.voteError.sideLocked', defaultMessage: 'Your side is locked for this match' });
    case 'fighters_cant':
      return intl.formatMessage({ id: 'crowd.voteError.fightersCant', defaultMessage: "Fighters can't vote — your crowd votes for you" });
    case 'not_signed_up':
      return intl.formatMessage({ id: 'crowd.voteError.notSignedUp', defaultMessage: 'Sign up to vote' });
    case 'no_call':
      return intl.formatMessage({ id: 'crowd.voteError.noCall', defaultMessage: 'Voting has closed' });
    case 'bad_card':
      return intl.formatMessage({ id: 'crowd.voteError.badCard', defaultMessage: "That card isn't on offer" });
    case 'rate_limited':
      return intl.formatMessage({ id: 'crowd.voteError.rateLimited', defaultMessage: 'Too fast — try again in a moment' });
    default:
      return intl.formatMessage({ id: 'crowd.voteError.generic', defaultMessage: "Couldn't send your vote" });
  }
}

export interface CrowdCallsState {
  current: CrowdCallView | null;
  history: CrowdCallView[];
}

/** The latest `calls` message, kept outside React state so its ~4 Hz updates
 * re-render only what reads it (the vote panel, the HUD) — not the chat. */
export interface CrowdCallsStore {
  get: () => CrowdCallsState;
  set: (next: CrowdCallsState) => void;
  subscribe: (listener: () => void) => () => void;
}

const NO_CALLS: CrowdCallsState = { current: null, history: [] };

export function createCrowdCallsStore(): CrowdCallsStore {
  let state = NO_CALLS;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useCrowdCalls(store: CrowdCallsStore): CrowdCallsState {
  return useSyncExternalStore(store.subscribe, store.get);
}
