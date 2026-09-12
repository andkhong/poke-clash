import { describe, expect, it } from 'vitest';
import type { PredictionOptionSummary, PredictionSummary } from '../../net/protocol';
import { TEAM_A_COLOR_CSS } from '../teamColors';
import { SOLARIZED_ACCENTS } from '../theme';
import {
  canAffordChip,
  canBetOn,
  favouriteOptionId,
  formatAmount,
  formatCloseCountdown,
  formatDollars,
  impliedMultiplier,
  optionColor,
  percentLabel,
  resultText,
  stakeForChip,
  watchedText,
  withBalance,
} from './predictionModel';

function option(id: string, overrides: Partial<PredictionOptionSummary> = {}): PredictionOptionSummary {
  return { id, label: id, instanceIds: [id], total: 0, bettors: 0, odds: 0, alive: true, ...overrides };
}

function prediction(overrides: Partial<PredictionSummary> = {}): PredictionSummary {
  return {
    matchNo: 1,
    status: 'open',
    openedAtMs: 0,
    closesAtMs: 45_000,
    pool: 0,
    options: [option('p0-1', { label: 'Lunatone', odds: 0.62 }), option('p1-2', { label: 'Aggron', odds: 0.38 })],
    winnerOptionId: null,
    refunded: false,
    ...overrides,
  };
}

describe('formatting', () => {
  it('groups thousands and prefixes dollars', () => {
    expect(formatAmount(2400)).toBe('2,400');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount(1234567)).toBe('1,234,567');
    expect(formatAmount(-1500)).toBe('-1,500');
    expect(formatDollars(100)).toBe('$100');
    expect(formatDollars(-50)).toBe('-$50');
  });

  it('decorates a name with its balance only when there is one', () => {
    expect(withBalance('piplup', 100)).toBe('piplup ($100)');
    expect(withBalance('Slowpoke482', 1250)).toBe('Slowpoke482 ($1,250)');
    expect(withBalance('piplup', null)).toBe('piplup');
    expect(withBalance('piplup', undefined)).toBe('piplup');
  });

  it('renders the close countdown as zero-padded MM:SS, ceilinged', () => {
    expect(formatCloseCountdown(18_400)).toBe('00:19');
    expect(formatCloseCountdown(18_000)).toBe('00:18');
    expect(formatCloseCountdown(0)).toBe('00:00');
    expect(formatCloseCountdown(-5)).toBe('00:00');
    expect(formatCloseCountdown(61_000)).toBe('01:01');
  });

  it('rounds odds to a whole percent and clamps', () => {
    expect(percentLabel(0.624)).toBe('62%');
    expect(percentLabel(1)).toBe('100%');
    expect(percentLabel(1.2)).toBe('100%');
    expect(percentLabel(-0.1)).toBe('0%');
  });

  it('shows the parimutuel multiplier, or a dash for an unbacked option', () => {
    expect(impliedMultiplier(2400, 1000)).toBe('2.4x');
    expect(impliedMultiplier(100, 100)).toBe('1.0x');
    expect(impliedMultiplier(100, 0)).toBe('—');
  });
});

describe('favourite / stakes / bettability', () => {
  it('stars the best odds among living options and nothing once settled', () => {
    expect(favouriteOptionId(prediction())).toBe('p0-1');
    expect(favouriteOptionId(prediction({ options: [option('a', { odds: 0.9, alive: false }), option('b', { odds: 0.1 })] }))).toBe('b');
    expect(favouriteOptionId(prediction({ status: 'settled', winnerOptionId: 'p0-1' }))).toBeNull();
    expect(favouriteOptionId(prediction({ options: [] }))).toBeNull();
  });

  it('turns a chip into a stake against the balance', () => {
    expect(stakeForChip(25, 100)).toBe(25);
    expect(stakeForChip('all', 37)).toBe(37);
    expect(stakeForChip('all', -3)).toBe(0);
    expect(canAffordChip(50, 37)).toBe(false);
    expect(canAffordChip(25, 37)).toBe(true);
    expect(canAffordChip('all', 0)).toBe(false);
  });

  it('only allows a tap the server would accept', () => {
    const p = prediction();
    const [a, b] = p.options;
    expect(canBetOn(p, a, null)).toBe(true);
    expect(canBetOn(p, a, { optionId: 'p0-1', amount: 10 })).toBe(true);
    expect(canBetOn(p, b, { optionId: 'p0-1', amount: 10 })).toBe(false);
    expect(canBetOn(p, option('dead', { alive: false }), null)).toBe(false);
    expect(canBetOn(prediction({ status: 'closed' }), a, null)).toBe(false);
  });
});

describe('result lines', () => {
  it('is silent until settled, then names the winner and this viewer\'s net', () => {
    expect(resultText(prediction(), { matchNo: 1, staked: 10, returned: 0, watched: 100 })).toBeNull();
    const won = prediction({ status: 'settled', winnerOptionId: 'p0-1', pool: 200 });
    expect(resultText(won, { matchNo: 1, staked: 50, returned: 170, watched: 100 })).toBe('LUNATONE WINS · you +$120');
    expect(resultText(won, { matchNo: 1, staked: 50, returned: 0, watched: 100 })).toBe('LUNATONE WINS · you -$50');
    expect(resultText(won, { matchNo: 1, staked: 0, returned: 0, watched: 100 })).toBe('LUNATONE WINS');
    expect(resultText(won, null)).toBe('LUNATONE WINS');
  });

  it('explains a refund, and a pool nobody joined', () => {
    expect(resultText(prediction({ status: 'settled', refunded: true, pool: 60 }), { matchNo: 1, staked: 60, returned: 60, watched: 0 })).toBe('NO WINNER · bets refunded');
    expect(resultText(prediction({ status: 'settled', refunded: true, pool: 0 }), null)).toBe('NO WINNER');
    expect(resultText(prediction({ status: 'settled', winnerOptionId: 'p1-2', refunded: true, pool: 40 }), null)).toBe('AGGRON WINS · bets refunded');
  });

  it('mentions the watch reward only when one was earned', () => {
    expect(watchedText({ matchNo: 1, staked: 0, returned: 0, watched: 100 })).toBe('+$100 for watching');
    expect(watchedText({ matchNo: 1, staked: 0, returned: 0, watched: 0 })).toBeNull();
    expect(watchedText(null)).toBeNull();
  });
});

describe('optionColor', () => {
  it('matches chat\'s per-seat hue in a free-for-all and the side colour in a team room', () => {
    expect(optionColor(option('p3-77', { instanceIds: ['p3-77'] }))).toBe(SOLARIZED_ACCENTS[3]);
    expect(optionColor(option('p9-77', { instanceIds: ['p9-77'] }))).toBe(SOLARIZED_ACCENTS[1]);
    expect(optionColor(option('teamA', { instanceIds: ['p0-1', 'p1-2'] }))).toBe(TEAM_A_COLOR_CSS);
    expect(typeof optionColor(option('boss', { instanceIds: ['boss-5'] }))).toBe('string');
  });
});
