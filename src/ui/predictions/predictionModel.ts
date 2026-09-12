import type { MyBet, PredictionOptionSummary, PredictionSummary, WalletEventPayload } from '../../net/protocol';
import { teamColorCss } from '../teamColors';
import { ACCENT, SECONDARY, SOLARIZED_ACCENTS } from '../theme';

/** Pure predictions-panel presentation logic, kept out of the component so
 * it can be unit-tested under Vitest's node environment (same split as
 * chat/chatModel.ts). */

export type StakeChip = number | 'all';

/** 2400 → "2,400"; negatives keep their sign. */
export function formatAmount(amount: number): string {
  const whole = Math.trunc(Math.abs(amount));
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return amount < 0 ? `-${grouped}` : grouped;
}

export function formatDollars(amount: number): string {
  return amount < 0 ? `-$${formatAmount(-amount)}` : `$${formatAmount(amount)}`;
}

/** "piplup ($100)" — the display-name convention everywhere a name shows
 * next to its wallet; a name with no known balance is left alone. */
export function withBalance(name: string, balance: number | null | undefined): string {
  return balance === null || balance === undefined ? name : `${name} (${formatDollars(balance)})`;
}

/** "Closes in 00:18" — zero-padded MM:SS, ceilinged so it never reads 00:00
 * while a fraction of a second is left. */
export function formatCloseCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function percentLabel(probability: number): string {
  return `${Math.round(Math.max(0, Math.min(1, probability)) * 100)}%`;
}

/** What $1 on this option returns if it wins, at the pool as it stands —
 * "—" while nobody's on it (the parimutuel share is undefined). */
export function impliedMultiplier(pool: number, optionTotal: number): string {
  if (optionTotal <= 0) return '—';
  return `${(pool / optionTotal).toFixed(1)}x`;
}

/** The option with the best odds among those still standing — the one the
 * panel stars — or null once the pool is settled (the winner is marked
 * instead) or nobody's left. */
export function favouriteOptionId(prediction: PredictionSummary): string | null {
  if (prediction.status === 'settled') return null;
  let best: PredictionOptionSummary | null = null;
  for (const option of prediction.options) {
    if (!option.alive) continue;
    if (best === null || option.odds > best.odds) best = option;
  }
  return best?.id ?? null;
}

export function stakeForChip(chip: StakeChip, balance: number): number {
  return chip === 'all' ? Math.max(0, balance) : chip;
}

export function canAffordChip(chip: StakeChip, balance: number): boolean {
  return stakeForChip(chip, balance) >= 1 && stakeForChip(chip, balance) <= balance;
}

/** Whether tapping this option would be accepted right now — mirrors the
 * server's placeBet rules so a doomed tap is disabled, not bounced. */
export function canBetOn(prediction: PredictionSummary, option: PredictionOptionSummary, myBet: MyBet | null): boolean {
  if (prediction.status !== 'open' || !option.alive) return false;
  return myBet === null || myBet.optionId === option.id;
}

/** The settled headline: who won and how this viewer did — "LUNATONE WINS ·
 * you +$120", "NO WINNER · bets refunded". Null until the pool is settled. */
export function resultText(prediction: PredictionSummary, settled: WalletEventPayload['settled'] | null | undefined): string | null {
  if (prediction.status !== 'settled') return null;
  const winner = prediction.options.find((o) => o.id === prediction.winnerOptionId) ?? null;
  const head = winner ? `${winner.label.toUpperCase()} WINS` : 'NO WINNER';
  if (prediction.refunded) return prediction.pool > 0 ? `${head} · bets refunded` : head;
  if (!settled || settled.staked === 0) return head;
  const net = settled.returned - settled.staked;
  return `${head} · you ${net >= 0 ? '+' : '-'}${formatDollars(Math.abs(net))}`;
}

/** "+$100 for watching", or null when this viewer earned nothing. */
export function watchedText(settled: WalletEventPayload['settled'] | null | undefined): string | null {
  return settled && settled.watched > 0 ? `+${formatDollars(settled.watched)} for watching` : null;
}

/** An option's colour — its side's in a team room, boss/party accents, or
 * the same per-seat hue chat gives that seat's player (see chatSenderColor),
 * so a fighter reads the same colour in the pool as in the chat. */
export function optionColor(option: PredictionOptionSummary): string {
  const team = teamColorCss(option.id);
  if (team) return team;
  if (option.id === 'boss') return ACCENT;
  if (option.id === 'party') return SECONDARY;
  const slot = /^p(\d+)-/.exec(option.instanceIds[0] ?? '');
  const slotIndex = slot ? Number(slot[1]) : 0;
  return SOLARIZED_ACCENTS[slotIndex % SOLARIZED_ACCENTS.length];
}

/** Short user-facing notice for a rejected bet (server error codes from
 * game-server/predictions.ts's PlaceBetError, plus the client's own). */
export function betErrorNotice(error: string): string {
  switch (error) {
    case 'closed':
      return 'Betting is closed';
    case 'insufficient_funds':
      return 'Not enough Pokémon Dollars';
    case 'option_locked':
      return 'Already fainted';
    case 'cannot_switch':
      return 'You already backed another';
    case 'no_prediction':
      return 'No match to bet on';
    default:
      return 'Couldn’t place bet';
  }
}
