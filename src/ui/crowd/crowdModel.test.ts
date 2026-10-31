import { describe, expect, it } from 'vitest';
import type { CrowdCallSide, CrowdCallView } from '../../net/play/playProtocol';
import {
  callStatus,
  callsPerMatch,
  createCrowdCallsStore,
  formatClock,
  nextCallAtMs,
  tallySide,
  voteErrorText,
  winnerLabel,
} from './crowdModel';

function side(overrides: Partial<CrowdCallSide> = {}): CrowdCallSide {
  return { cards: ['speed', 'shield', 'energy'], votes: {}, winner: null, housePick: false, ...overrides };
}

function call(overrides: Partial<CrowdCallView> = {}): CrowdCallView {
  return {
    index: 1,
    phase: 'voting',
    opensAtMs: 20_000,
    closesAtMs: 30_000,
    landsAtMs: 32_000,
    sides: { teamA: side(), teamB: side() },
    ...overrides,
  };
}

describe('tallySide', () => {
  it('rounds percentages and marks every tied leader', () => {
    const t = tallySide(side({ votes: { speed: 2, shield: 2, energy: 1 } }));
    expect(t.total).toBe(5);
    expect(t.cards.map((c) => c.pct)).toEqual([40, 40, 20]);
    expect(t.cards.map((c) => c.leading)).toEqual([true, true, false]);
  });

  it('has no leader and 0% with no votes', () => {
    const t = tallySide(side());
    expect(t.total).toBe(0);
    expect(t.cards.every((c) => c.pct === 0 && !c.leading)).toBe(true);
  });
});

describe('callStatus', () => {
  it('counts down to the first call before any exists', () => {
    expect(callStatus(null, 5_000)).toEqual({ kind: 'waiting', nextInMs: 15_000 });
  });

  it('reports seconds and the share of the vote window left', () => {
    expect(callStatus(call(), 25_000)).toEqual({ kind: 'voting', closesInS: 5, left: 0.5 });
    expect(callStatus(call(), 31_000)).toMatchObject({ closesInS: 0, left: 0 });
  });

  it('counts down landing, then to the next call', () => {
    expect(callStatus(call({ phase: 'landing' }), 30_500)).toEqual({ kind: 'landing', landsInS: 2 });
    expect(callStatus(call({ phase: 'landed' }), 40_000)).toEqual({ kind: 'landed', nextInMs: 10_000 });
    expect(nextCallAtMs(call())).toBe(50_000);
  });
});

describe('labels', () => {
  it('formats the clock and the house pick', () => {
    expect(formatClock(84_000)).toBe('1:24');
    expect(formatClock(-1)).toBe('0:00');
    expect(winnerLabel(side({ winner: 'shield', housePick: true }))).toBe('House pick: Shield');
    expect(winnerLabel(side({ winner: 'supply' }))).toBe('Supply Drop');
    expect(winnerLabel(side())).toBeNull();
    expect(voteErrorText('side_locked', 'teamB')).toContain('Sapphire');
  });

  it('fits five calls in a three-minute match', () => {
    expect(callsPerMatch(180_000)).toBe(5);
  });
});

describe('createCrowdCallsStore', () => {
  it('notifies subscribers until they unsubscribe', () => {
    const store = createCrowdCallsStore();
    let hits = 0;
    const off = store.subscribe(() => hits++);
    store.set({ current: call(), history: [] });
    off();
    store.set({ current: null, history: [] });
    expect(hits).toBe(1);
    expect(store.get().current).toBeNull();
  });
});
