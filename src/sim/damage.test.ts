import { describe, expect, it } from 'vitest';
import { resolveDamage, rollAccuracy } from './damage';
import { createNeutralStages } from './statCalc';
import type { MoveDefinition, PokemonInstance } from './types';

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
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    ...overrides,
  };
}

const tackle: MoveDefinition = {
  id: 1,
  name: 'Test Tackle',
  type: 'normal',
  category: 'physical',
  power: 80,
  accuracy: null, // isolate the damage-formula test from the accuracy roll
  pp: 20,
  priority: 0,
  targeting: 'enemy',
};

describe('resolveDamage', () => {
  it('matches hand-computed Gen6+ formula output for a deterministic rng sequence', () => {
    const attacker = makeInstance({ instanceId: 'atk', types: ['normal'] });
    const defender = makeInstance({ instanceId: 'def', types: ['water'] });
    // sequence: [crit-roll (>= critChance -> no crit), random-damage-factor -> 0.925]
    const rng = fakeRng([0.99, 0.5]);

    const result = resolveDamage(rng, tackle, attacker, defender);

    expect(result.hit).toBe(true);
    expect(result.crit).toBe(false);
    expect(result.effectiveness).toBe(1);
    expect(result.damage).toBe(96);
  });

  it('applies STAB only when the attacker shares the move type', () => {
    const rng1 = fakeRng([0.99, 0.5]);
    const attackerWithStab = makeInstance({ types: ['normal'] });
    const defender = makeInstance({ types: ['water'] });
    const withStab = resolveDamage(rng1, tackle, attackerWithStab, defender);

    const rng2 = fakeRng([0.99, 0.5]);
    const attackerNoStab = makeInstance({ types: ['fighting'] });
    const withoutStab = resolveDamage(rng2, tackle, attackerNoStab, defender);

    expect(withStab.damage).toBeGreaterThan(withoutStab.damage);
  });

  it('deals 0 damage against an immune defender', () => {
    const groundMove: MoveDefinition = { ...tackle, type: 'ground' };
    const attacker = makeInstance({ types: ['ground'] });
    const flyingDefender = makeInstance({ types: ['flying'] });
    const rng = fakeRng([0.99, 0.5]);

    const result = resolveDamage(rng, groundMove, attacker, flyingDefender);
    expect(result.damage).toBe(0);
    expect(result.effectiveness).toBe(0);
  });

  it('halves physical damage when the attacker is burned', () => {
    const attackerHealthy = makeInstance({ types: ['normal'] });
    const attackerBurned = makeInstance({ types: ['normal'], status: 'burn' });
    const defender = makeInstance({ types: ['water'] });

    const healthy = resolveDamage(fakeRng([0.99, 0.5]), tackle, attackerHealthy, defender);
    const burned = resolveDamage(fakeRng([0.99, 0.5]), tackle, attackerBurned, defender);

    expect(burned.damage).toBeLessThan(healthy.damage);
  });

  it('never misses when move.accuracy is null', () => {
    const attacker = makeInstance();
    const defender = makeInstance();
    // even a "roll" that would normally fail should not matter since accuracy is null
    expect(rollAccuracy(fakeRng([0.0]), tackle, attacker, defender)).toBe(true);
  });

  it('typeless moves (Struggle) ignore the type chart and STAB entirely', () => {
    const typelessMove: MoveDefinition = { ...tackle, type: 'fire', typeless: true };
    const attacker = makeInstance({ types: ['water'] }); // would resist its own "fire" label if not typeless
    const defender = makeInstance({ types: ['water'] }); // fire vs water would normally be 0.5x
    const rng = fakeRng([0.99, 0.5]);

    const result = resolveDamage(rng, typelessMove, attacker, defender);
    expect(result.effectiveness).toBe(1);
  });
});
