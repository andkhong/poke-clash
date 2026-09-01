import { describe, expect, it } from 'vitest';
import { computeStats, createNeutralStages, getStageMultiplier } from './statCalc';

describe('computeStats', () => {
  it('matches known real-game values for Charizard at level 100 (IV31/EV0/neutral)', () => {
    // Charizard base stats: 78/84/78/109/85/100
    const stats = computeStats({ hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, 100);
    // Verified against the standard Gen3+ formula by hand at IV=31, EV=0, level=100.
    expect(stats.hp).toBe(297);
    expect(stats.spe).toBe(volatileExpected(100));
  });

  function volatileExpected(base: number): number {
    return Math.floor(((2 * base + 31) * 100) / 100) + 5;
  }

  it('scales down at lower levels', () => {
    const at50 = computeStats({ hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, 50);
    const at100 = computeStats({ hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100 }, 100);
    expect(at50.hp).toBeLessThan(at100.hp);
    expect(at50.atk).toBeLessThan(at100.atk);
  });
});

describe('getStageMultiplier', () => {
  it('uses the (2+n)/2 curve for core stats', () => {
    expect(getStageMultiplier('atk', 0)).toBe(1);
    expect(getStageMultiplier('atk', 2)).toBeCloseTo(2);
    expect(getStageMultiplier('atk', 6)).toBeCloseTo(4);
    expect(getStageMultiplier('atk', -2)).toBeCloseTo(0.5);
    expect(getStageMultiplier('atk', -6)).toBeCloseTo(0.25);
  });

  it('uses the different (3+n)/3 curve for accuracy/evasion', () => {
    expect(getStageMultiplier('accuracy', 0)).toBe(1);
    expect(getStageMultiplier('accuracy', 6)).toBeCloseTo(3);
    expect(getStageMultiplier('accuracy', -6)).toBeCloseTo(1 / 3);
    // This must differ from the core-stat curve at the same stage — the classic bug.
    expect(getStageMultiplier('accuracy', 2)).not.toBeCloseTo(getStageMultiplier('atk', 2));
  });

  it('clamps stages to [-6, 6]', () => {
    expect(getStageMultiplier('atk', 99)).toBe(getStageMultiplier('atk', 6));
    expect(getStageMultiplier('atk', -99)).toBe(getStageMultiplier('atk', -6));
  });
});

describe('createNeutralStages', () => {
  it('starts every stage at 0', () => {
    const stages = createNeutralStages();
    for (const v of Object.values(stages)) expect(v).toBe(0);
  });
});
