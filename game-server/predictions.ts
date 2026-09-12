import type { SimState } from '../src/sim/types';
import type { MoveLookup } from '../src/sim/matchSetup';
import { AGGRESSION_TRIGGER_MS } from '../src/sim/constants';
import { computeWinOdds } from '../src/sim/odds';
import type { MyBet, PredictionOptionSummary, PredictionStatus, PredictionSummary, RoomMode } from '../src/net/protocol';
import { MIN_BET } from '../src/net/predictions';

/** One room's prediction pool for one match — pure bookkeeping over a sim
 * state snapshot, with no wallet, timer or SSE knowledge: roomManager owns
 * when to open/close/settle and moves the money; this module says what the
 * pool looks like and who gets what. Everything here is synchronous and
 * deterministic so it can be unit-tested without a room. */

export interface PredictionOption {
  id: string;
  label: string;
  instanceIds: string[];
  total: number;
  bettors: number;
}

export interface PredictionState {
  matchNo: number;
  status: PredictionStatus;
  openedAtMs: number;
  closesAtMs: number;
  options: PredictionOption[];
  /** Keyed by session id — never serialised as-is (see toPredictionSummary). */
  bets: Map<string, MyBet>;
  odds: Record<string, number>;
  winnerOptionId: string | null;
  refunded: boolean;
  /** What each betting session gets back at settlement (payout or refund). */
  payouts: Map<string, number>;
}

export type PlaceBetError =
  | 'no_prediction'
  | 'closed'
  | 'invalid_amount'
  | 'unknown_option'
  | 'option_locked'
  | 'cannot_switch'
  | 'insufficient_funds';

function optionLabel(mode: RoomMode, team: string, state: Readonly<SimState>, memberIds: string[]): string {
  if (mode === 'boss') return team === 'boss' ? `Boss · ${state.pokemon[memberIds[0]].name}` : 'Party';
  if (team === 'teamA') return 'Team A';
  if (team === 'teamB') return 'Team B';
  return state.pokemon[memberIds[0]].name;
}

/** One option per distinct sim team, in spawn order — in a free-for-all every
 * fighter is its own team (matchSetup.ts), so that's one per fighter; boss
 * and team rooms collapse to their two sides. Keying on the team makes
 * winner resolution uniform across modes: the winner is whichever option's
 * team the surviving Pokémon belong to. */
export function buildPredictionOptions(mode: RoomMode, state: Readonly<SimState>): PredictionOption[] {
  const membersByTeam = new Map<string, string[]>();
  for (const id of state.allInstanceIds) {
    const team = state.pokemon[id].team;
    const members = membersByTeam.get(team);
    if (members) members.push(id);
    else membersByTeam.set(team, [id]);
  }
  return [...membersByTeam.entries()].map(([team, instanceIds]) => ({
    id: team,
    label: optionLabel(mode, team, state, instanceIds),
    instanceIds,
    total: 0,
    bettors: 0,
  }));
}

export function openPrediction(mode: RoomMode, state: Readonly<SimState>, matchNo: number, nowMs: number, moveLookup: MoveLookup): PredictionState {
  const options = buildPredictionOptions(mode, state);
  return {
    matchNo,
    status: 'open',
    openedAtMs: nowMs,
    // The sim clock runs at wall-clock pace (see roomManager's tick loop), so
    // this is where the aggression mark lands in server time — the sim's own
    // elapsedMs is still the gate that actually closes the window.
    closesAtMs: nowMs + AGGRESSION_TRIGGER_MS,
    options,
    bets: new Map(),
    odds: computeWinOdds(state, moveLookup, options),
    winnerOptionId: null,
    refunded: false,
    payouts: new Map(),
  };
}

export function isOptionAlive(option: PredictionOption, state: Readonly<SimState>): boolean {
  return option.instanceIds.some((id) => state.livingOrder.includes(id));
}

/** Records a bet. Checks run in the order a bettor would want to hear about
 * them (is there a pool → is it open → is the amount sane → is the option
 * real and still standing → am I allowed to pick it → can I afford it).
 * Mutates the pool on success; the caller debits the wallet. A second bet on
 * the same option tops the first up; a bet on a different option is refused. */
export function placeBet(
  prediction: PredictionState | null,
  state: Readonly<SimState>,
  sessionId: string,
  optionId: string,
  amount: number,
  balance: number
): { ok: true; bet: MyBet } | { ok: false; error: PlaceBetError } {
  if (!prediction) return { ok: false, error: 'no_prediction' };
  if (prediction.status !== 'open') return { ok: false, error: 'closed' };
  if (!Number.isInteger(amount) || amount < MIN_BET) return { ok: false, error: 'invalid_amount' };
  const option = prediction.options.find((o) => o.id === optionId);
  if (!option) return { ok: false, error: 'unknown_option' };
  if (!isOptionAlive(option, state)) return { ok: false, error: 'option_locked' };
  const existing = prediction.bets.get(sessionId);
  if (existing && existing.optionId !== optionId) return { ok: false, error: 'cannot_switch' };
  if (amount > balance) return { ok: false, error: 'insufficient_funds' };

  option.total += amount;
  if (!existing) option.bettors += 1;
  const bet: MyBet = { optionId, amount: (existing?.amount ?? 0) + amount };
  prediction.bets.set(sessionId, bet);
  return { ok: true, bet };
}

/** The option the match's winners belong to, or null when there's no single
 * answer: no winner at all, or co-winners (the 120 s cap / a simultaneous
 * last KO) spread across more than one option. In a team/boss room a whole
 * surviving side is one option, so several winners there still resolve. */
export function resolveWinnerOption(prediction: PredictionState, state: Readonly<SimState>): string | null {
  const teams = new Set(state.winnerInstanceIds.map((id) => state.pokemon[id].team));
  if (teams.size !== 1) return null;
  const [team] = teams;
  return prediction.options.some((o) => o.id === team) ? team : null;
}

/** Parimutuel: the whole pool is shared among the winning option's bettors
 * in proportion to their stakes, floored (the odd dollar of rounding stays
 * in the house). With no winner, or nobody on the winner, everyone simply
 * gets their own stake back. */
export function computePayouts(bets: ReadonlyMap<string, MyBet>, winnerOptionId: string | null): { refunded: boolean; payouts: Map<string, number> } {
  const payouts = new Map<string, number>();
  let pool = 0;
  let winningTotal = 0;
  for (const bet of bets.values()) {
    pool += bet.amount;
    if (bet.optionId === winnerOptionId) winningTotal += bet.amount;
  }
  if (winnerOptionId === null || winningTotal === 0) {
    for (const [sessionId, bet] of bets) payouts.set(sessionId, bet.amount);
    return { refunded: true, payouts };
  }
  for (const [sessionId, bet] of bets) {
    if (bet.optionId === winnerOptionId) payouts.set(sessionId, Math.floor((pool * bet.amount) / winningTotal));
  }
  return { refunded: false, payouts };
}

/** Finalises the pool against the finished match: closes it if it was still
 * open (a match that ends before the aggression mark), resolves the winner,
 * works out payouts, and re-derives the odds one last time (a lone survivor
 * reads 100 %). Idempotent-safe: a settled pool is left alone. */
export function settlePrediction(prediction: PredictionState, state: Readonly<SimState>, moveLookup: MoveLookup): void {
  if (prediction.status === 'settled') return;
  prediction.winnerOptionId = resolveWinnerOption(prediction, state);
  const { refunded, payouts } = computePayouts(prediction.bets, prediction.winnerOptionId);
  prediction.refunded = refunded;
  prediction.payouts = payouts;
  prediction.odds = computeWinOdds(state, moveLookup, prediction.options);
  prediction.status = 'settled';
}

/** The public view: totals and odds per option, never a session id. */
export function toPredictionSummary(prediction: PredictionState, state: Readonly<SimState>): PredictionSummary {
  const options: PredictionOptionSummary[] = prediction.options.map((option) => ({
    id: option.id,
    label: option.label,
    instanceIds: option.instanceIds,
    total: option.total,
    bettors: option.bettors,
    odds: prediction.odds[option.id] ?? 0,
    alive: isOptionAlive(option, state),
  }));
  return {
    matchNo: prediction.matchNo,
    status: prediction.status,
    openedAtMs: prediction.openedAtMs,
    closesAtMs: prediction.closesAtMs,
    pool: options.reduce((sum, option) => sum + option.total, 0),
    options,
    winnerOptionId: prediction.winnerOptionId,
    refunded: prediction.refunded,
  };
}
