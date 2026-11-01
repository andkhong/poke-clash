import { describe, expect, it } from 'vitest';
import {
  buildPredictionOptions,
  computePayouts,
  openPrediction,
  placeBet,
  resolveWinnerOption,
  settlePrediction,
  toPredictionSummary,
} from './predictions';
import type { MyBet } from '../src/net/protocol';
import { createMatch } from '../src/sim/matchSetup';
import { createRng } from '../src/sim/rng';
import type { MatchConfig, SimState } from '../src/sim/types';
import { ARENA_HEIGHT, ARENA_WIDTH, AGGRESSION_TRIGGER_MS } from '../src/sim/constants';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup } from '../src/data/loader';

const SPECIES = listAllSpecies()
  .filter((s) => hasPmdSprite(s.id))
  .slice(0, 5)
  .map((s) => s.id);

function stateFor(overrides: Partial<MatchConfig> = {}): SimState {
  const config: MatchConfig = {
    level: 50,
    speciesIds: SPECIES.slice(0, 4),
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    shiny: false,
    ...overrides,
  };
  const ids = [...config.speciesIds, ...(config.boss ? [config.boss.speciesId] : [])];
  return createMatch(config, buildSpeciesMapForLevel(ids, 50), moveLookup, createRng(7));
}

function faint(state: SimState, ...ids: string[]) {
  for (const id of ids) {
    state.pokemon[id].currentHp = 0;
    state.livingOrder = state.livingOrder.filter((living) => living !== id);
    state.eliminationOrder.push(id);
  }
}

function finish(state: SimState) {
  state.phase = 'complete';
  state.winnerInstanceIds = [...state.livingOrder];
}

describe('buildPredictionOptions', () => {
  it('makes every fighter its own option in a free-for-all, in spawn order, labelled by name', () => {
    const state = stateFor();
    const options = buildPredictionOptions(state);
    expect(options.map((o) => o.id)).toEqual(state.allInstanceIds);
    expect(options.map((o) => o.instanceIds)).toEqual(state.allInstanceIds.map((id) => [id]));
    expect(options.map((o) => o.label)).toEqual(state.allInstanceIds.map((id) => state.pokemon[id].name));
  });

  it('collapses a team room to its two sides', () => {
    const state = stateFor({ teams: { size: 2 } });
    const options = buildPredictionOptions(state);
    expect(options.map((o) => [o.id, o.label, o.instanceIds.length])).toEqual([
      ['teamA', 'Team Ruby', 2],
      ['teamB', 'Team Sapphire', 2],
    ]);
  });
});

describe('placeBet', () => {
  it('rejects in a bettor-friendly order and accumulates a repeat bet on the same option', () => {
    const state = stateFor();
    const p = openPrediction(state, 1, 1000, moveLookup);
    const [a, b] = state.allInstanceIds;
    expect(p.closesAtMs).toBe(1000 + AGGRESSION_TRIGGER_MS);

    expect(placeBet(null, state, 's', a, 10, 100)).toEqual({ ok: false, error: 'no_prediction' });
    expect(placeBet(p, state, 's', a, 0, 100)).toEqual({ ok: false, error: 'invalid_amount' });
    expect(placeBet(p, state, 's', a, 2.5, 100)).toEqual({ ok: false, error: 'invalid_amount' });
    expect(placeBet(p, state, 's', 'nope', 10, 100)).toEqual({ ok: false, error: 'unknown_option' });
    expect(placeBet(p, state, 's', a, 101, 100)).toEqual({ ok: false, error: 'insufficient_funds' });

    expect(placeBet(p, state, 's', a, 40, 100)).toEqual({ ok: true, bet: { optionId: a, amount: 40 } });
    expect(placeBet(p, state, 's', b, 10, 60)).toEqual({ ok: false, error: 'cannot_switch' });
    expect(placeBet(p, state, 's', a, 10, 60)).toEqual({ ok: true, bet: { optionId: a, amount: 50 } });
    expect(placeBet(p, state, 't', a, 5, 100)).toEqual({ ok: true, bet: { optionId: a, amount: 5 } });
    expect(p.options[0]).toMatchObject({ total: 55, bettors: 2 });

    faint(state, b);
    expect(placeBet(p, state, 'u', b, 5, 100)).toEqual({ ok: false, error: 'option_locked' });

    p.status = 'closed';
    expect(placeBet(p, state, 'u', a, 5, 100)).toEqual({ ok: false, error: 'closed' });
  });
});

describe('computePayouts', () => {
  const bets = (entries: Array<[string, string, number]>): Map<string, MyBet> =>
    new Map(entries.map(([sessionId, optionId, amount]) => [sessionId, { optionId, amount }]));

  it("splits the whole pool among the winner's backers pro-rata, flooring", () => {
    const result = computePayouts(
      bets([
        ['a', 'x', 30],
        ['b', 'x', 20],
        ['c', 'y', 50],
      ]),
      'x'
    );
    expect(result.refunded).toBe(false);
    expect([...result.payouts]).toEqual([
      ['a', 60],
      ['b', 40],
    ]);

    const odd = computePayouts(
      bets([
        ['a', 'x', 30],
        ['b', 'x', 20],
        ['c', 'y', 51],
      ]),
      'x'
    );
    expect([...odd.payouts]).toEqual([
      ['a', 60],
      ['b', 40],
    ]); // 101*30/50=60.6, 101*20/50=40.4 — the odd dollar stays
  });

  it('refunds everyone when nobody backed the winner, or there is no winner', () => {
    expect(
      computePayouts(
        bets([
          ['a', 'x', 30],
          ['b', 'y', 20],
        ]),
        'z'
      )
    ).toEqual({
      refunded: true,
      payouts: new Map([
        ['a', 30],
        ['b', 20],
      ]),
    });
    expect(computePayouts(bets([['a', 'x', 30]]), null)).toEqual({ refunded: true, payouts: new Map([['a', 30]]) });
    expect(computePayouts(new Map(), 'x')).toEqual({ refunded: true, payouts: new Map() });
  });
});

describe('resolveWinnerOption / settlePrediction', () => {
  it('names the lone survivor in a free-for-all and null for co-winners', () => {
    const state = stateFor();
    const p = openPrediction(state, 1, 0, moveLookup);
    const [a, b, c, d] = state.allInstanceIds;
    faint(state, b, c, d);
    finish(state);
    expect(resolveWinnerOption(p, state)).toBe(a);

    const tied = stateFor();
    const q = openPrediction(tied, 1, 0, moveLookup);
    faint(tied, tied.allInstanceIds[2], tied.allInstanceIds[3]);
    finish(tied);
    expect(tied.winnerInstanceIds).toHaveLength(2);
    expect(resolveWinnerOption(q, tied)).toBeNull();
  });

  it('resolves a whole surviving side in a team match', () => {
    const team = stateFor({ teams: { size: 2 } });
    const q = openPrediction(team, 1, 0, moveLookup);
    faint(team, ...team.allInstanceIds.filter((id) => team.pokemon[id].team === 'teamB'));
    finish(team);
    expect(resolveWinnerOption(q, team)).toBe('teamA');
  });

  it('settles once: closes, pays, re-derives odds to the survivor, and leaves a settled pool alone', () => {
    const state = stateFor();
    const p = openPrediction(state, 3, 0, moveLookup);
    const [a, b, c, d] = state.allInstanceIds;
    placeBet(p, state, 's', a, 20, 100);
    placeBet(p, state, 't', b, 30, 100);
    faint(state, b, c, d);
    finish(state);

    settlePrediction(p, state, moveLookup);
    expect(p).toMatchObject({ status: 'settled', winnerOptionId: a, refunded: false });
    expect([...p.payouts]).toEqual([['s', 50]]);
    expect(p.odds[a]).toBe(1);
    expect(p.odds[b]).toBe(0);

    p.payouts.set('tamper', 1);
    settlePrediction(p, state, moveLookup);
    expect(p.payouts.get('tamper')).toBe(1);
  });
});

describe('toPredictionSummary', () => {
  it('exposes totals, odds and liveness per option but never a session id', () => {
    const state = stateFor();
    const p = openPrediction(state, 2, 500, moveLookup);
    const [a, b] = state.allInstanceIds;
    placeBet(p, state, 'session-secret-1', a, 25, 100);
    placeBet(p, state, 'session-secret-2', b, 10, 100);
    faint(state, b);

    const summary = toPredictionSummary(p, state);
    expect(summary).toMatchObject({ matchNo: 2, status: 'open', openedAtMs: 500, pool: 35, winnerOptionId: null, refunded: false });
    expect(summary.options[0]).toMatchObject({ id: a, total: 25, bettors: 1, alive: true });
    expect(summary.options[1]).toMatchObject({ id: b, total: 10, bettors: 1, alive: false });
    expect(summary.options.reduce((sum, o) => sum + o.odds, 0)).toBeCloseTo(1, 6);
    expect(JSON.stringify(summary)).not.toContain('session-secret');
  });
});
