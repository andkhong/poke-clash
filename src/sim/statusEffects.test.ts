import { describe, expect, it } from 'vitest';
import { applyStatus, canApplyStatus, gateAction, maybeThawOnFireHit, tickStatusDamage } from './statusEffects';
import { createNeutralStages } from './statCalc';
import { FREEZE_MAX_TURNS } from './constants';
import type { PokemonInstance } from './types';

function fakeRng(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[Math.min(i++, sequence.length - 1)];
}

function makeInstance(overrides: Partial<PokemonInstance> = {}): PokemonInstance {
  return {
    instanceId: 'a',
    speciesId: 1,
    name: 'Test',
    level: 100,
    types: ['normal'],
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    computedStats: { hp: 300, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    statStages: createNeutralStages(),
    currentHp: 300,
    maxHp: 300,
    moves: [],
    status: null,
    statusTickAccumMs: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: 'S',
    collisionRadius: 40,
    team: 'a',
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    postAttackHoldMs: 0,
    ...overrides,
  };
}

describe('status application', () => {
  it('cannot stack a second major status on top of an existing one', () => {
    const p = makeInstance({ status: 'burn' });
    expect(canApplyStatus(p)).toBe(false);
    applyStatus(p, 'paralysis', fakeRng([0.5]));
    expect(p.status).toBe('burn');
  });

  it('sleep sets a 1-3 turn counter', () => {
    const p = makeInstance();
    applyStatus(p, 'sleep', fakeRng([0.999])); // rngIntInclusive(1,3) with high roll -> 3
    expect(p.status).toBe('sleep');
    expect(p.statusTurnsRemaining).toBeGreaterThanOrEqual(1);
    expect(p.statusTurnsRemaining).toBeLessThanOrEqual(3);
  });

  it('freeze always thaws by its FREEZE_MAX_TURNS ceiling even if every thaw roll fails', () => {
    const p = makeInstance();
    applyStatus(p, 'freeze', fakeRng([0.999]));
    expect(p.status).toBe('freeze');
    expect(p.statusTurnsRemaining).toBe(FREEZE_MAX_TURNS);

    const neverThaws = fakeRng([0.999]); // always above FREEZE_THAW_CHANCE
    let turns = 0;
    while (p.status === 'freeze' && turns < FREEZE_MAX_TURNS + 5) {
      const result = gateAction(p, neverThaws);
      turns++;
      if (p.status === 'freeze') expect(result).toEqual({ canAct: false });
      else expect(result).toEqual({ canAct: true, clearedStatus: 'freeze' });
    }
    expect(p.status).toBeNull();
    expect(p.statusTurnsRemaining).toBeUndefined();
    expect(turns).toBe(FREEZE_MAX_TURNS);
  });

  it('a Fire-type hit thaws a frozen Pokémon outright and clears its turn counter', () => {
    const p = makeInstance();
    applyStatus(p, 'freeze', fakeRng([0.999]));
    expect(maybeThawOnFireHit(p, false)).toBe(false);
    expect(p.status).toBe('freeze');
    expect(maybeThawOnFireHit(p, true)).toBe(true);
    expect(p.status).toBeNull();
    expect(p.statusTurnsRemaining).toBeUndefined();
  });
});

describe('gateAction', () => {
  it('sleep blocks acting until the counter reaches 0, then clears', () => {
    const p = makeInstance({ status: 'sleep', statusTurnsRemaining: 1 });
    const result = gateAction(p, fakeRng([0.5]));
    expect(result.canAct).toBe(true);
    expect(result.clearedStatus).toBe('sleep');
    expect(p.status).toBeNull();
  });

  it('sleep with turns remaining blocks the action and decrements', () => {
    const p = makeInstance({ status: 'sleep', statusTurnsRemaining: 2 });
    const result = gateAction(p, fakeRng([0.5]));
    expect(result.canAct).toBe(false);
    expect(p.statusTurnsRemaining).toBe(1);
    expect(p.status).toBe('sleep'); // still asleep
  });

  it('paralysis rolls a 25% full-para chance', () => {
    const failsToAct = makeInstance({ status: 'paralysis' });
    expect(gateAction(failsToAct, fakeRng([0.1])).canAct).toBe(false); // 0.1 < 0.25
    const actsFine = makeInstance({ status: 'paralysis' });
    expect(gateAction(actsFine, fakeRng([0.9])).canAct).toBe(true); // 0.9 >= 0.25
  });

  it('freeze thaws probabilistically', () => {
    const staysFrozen = makeInstance({ status: 'freeze' });
    const r1 = gateAction(staysFrozen, fakeRng([0.9])); // 0.9 >= 0.2 thaw chance -> stays frozen
    expect(r1.canAct).toBe(false);
    expect(staysFrozen.status).toBe('freeze');

    const thaws = makeInstance({ status: 'freeze' });
    const r2 = gateAction(thaws, fakeRng([0.05])); // 0.05 < 0.2 -> thaws
    expect(r2.canAct).toBe(true);
    expect(thaws.status).toBeNull();
  });

  it('no status always allows acting', () => {
    const p = makeInstance();
    expect(gateAction(p, fakeRng([0])).canAct).toBe(true);
  });
});

describe('tickStatusDamage', () => {
  it('does nothing before the 1000ms accumulator threshold', () => {
    const p = makeInstance({ status: 'burn', statusTickAccumMs: 0, maxHp: 320 });
    const { event, damage } = tickStatusDamage(p, 500, () => 1, 500);
    expect(event).toBeNull();
    expect(damage).toBe(0);
    expect(p.statusTickAccumMs).toBe(500);
  });

  it('applies 1/16 max HP burn damage once the threshold is crossed', () => {
    const p = makeInstance({ status: 'burn', statusTickAccumMs: 900, maxHp: 320 });
    const { event, damage } = tickStatusDamage(p, 200, () => 7, 1100);
    expect(damage).toBe(Math.floor(320 / 16));
    expect(event?.type).toBe('statusTick');
    expect(p.statusTickAccumMs).toBe(100); // 900+200-1000 carried over
  });

  it('applies 1/8 max HP poison damage', () => {
    const p = makeInstance({ status: 'poison', statusTickAccumMs: 1000, maxHp: 320 });
    const { damage } = tickStatusDamage(p, 0, () => 1, 1000);
    expect(damage).toBe(Math.floor(320 / 8));
  });

  it('is a no-op for non-DOT statuses', () => {
    const p = makeInstance({ status: 'paralysis', statusTickAccumMs: 1000 });
    const { event, damage } = tickStatusDamage(p, 500, () => 1, 1500);
    expect(event).toBeNull();
    expect(damage).toBe(0);
  });
});
