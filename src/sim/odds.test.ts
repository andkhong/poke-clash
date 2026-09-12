import { describe, expect, it } from 'vitest';
import { computeWinOdds, estimateMoveDamage, fighterStrength, ODDS_MIN_OFFENSE } from './odds';
import type { MoveDefinition, PokemonInstance, PokemonTypeName, SimState } from './types';
import { createNeutralStages } from './statCalc';
import { STAB_MULT } from './constants';

const WATER_SPECIAL: MoveDefinition = { id: 1, name: 'Surf', type: 'water', category: 'special', power: 90, accuracy: 100, pp: 15, priority: 0, targeting: 'enemy' };
const NORMAL_PHYSICAL: MoveDefinition = { id: 2, name: 'Tackle', type: 'normal', category: 'physical', power: 90, accuracy: 100, pp: 35, priority: 0, targeting: 'enemy' };
const GROWL: MoveDefinition = { id: 3, name: 'Growl', type: 'normal', category: 'status', power: null, accuracy: 100, pp: 40, priority: 0, targeting: 'enemy' };
const SHAKY: MoveDefinition = { ...NORMAL_PHYSICAL, id: 4, name: 'Shaky', accuracy: 50 };
const MOVES: Record<number, MoveDefinition> = { 1: WATER_SPECIAL, 2: NORMAL_PHYSICAL, 3: GROWL, 4: SHAKY };
const lookup = (id: number) => MOVES[id];

function fighter(instanceId: string, overrides: Partial<PokemonInstance> = {}): PokemonInstance {
  const stats = { hp: 200, atk: 120, def: 100, spa: 120, spd: 100, spe: 100 };
  return {
    instanceId,
    speciesId: 1,
    name: instanceId,
    level: 50,
    types: ['normal'],
    baseStats: stats,
    computedStats: stats,
    statStages: createNeutralStages(),
    currentHp: 200,
    maxHp: 200,
    moves: [{ moveId: 2, ppRemaining: 35, ppMax: 35 }],
    status: null,
    statusTickAccumMs: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: 'S',
    collisionRadius: 10,
    team: instanceId,
    shiny: false,
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    postAttackHoldMs: 0,
    ...overrides,
  };
}

function stateOf(fighters: PokemonInstance[], living = fighters.map((f) => f.instanceId)): SimState {
  return {
    tick: 0,
    elapsedMs: 0,
    pokemon: Object.fromEntries(fighters.map((f) => [f.instanceId, f])),
    allInstanceIds: fighters.map((f) => f.instanceId),
    livingOrder: living,
    eliminationOrder: fighters.map((f) => f.instanceId).filter((id) => !living.includes(id)),
    phase: 'battle',
    winnerInstanceIds: [],
    arena: { width: 900, height: 1950 },
    introDurationMs: 0,
    attackGate: { active: [], closedUntilMs: 0, lastAttackerId: null },
  };
}

const ffa = (fighters: PokemonInstance[]) => fighters.map((f) => ({ id: f.instanceId, instanceIds: [f.instanceId] }));
const types = (...t: PokemonTypeName[]) => t;

describe('estimateMoveDamage', () => {
  it('is zero for status moves and immunities, and scales with STAB, effectiveness and accuracy', () => {
    const attacker = fighter('a', { types: types('water') });
    const neutral = fighter('b');
    const fire = fighter('c', { types: types('fire') });
    const ghost = fighter('d', { types: types('ghost') });
    expect(estimateMoveDamage(attacker, GROWL, neutral)).toBe(0);
    expect(estimateMoveDamage(attacker, NORMAL_PHYSICAL, ghost)).toBe(0);
    const base = estimateMoveDamage(fighter('x'), WATER_SPECIAL, neutral);
    expect(estimateMoveDamage(attacker, WATER_SPECIAL, neutral)).toBeCloseTo(base * STAB_MULT, 6);
    expect(estimateMoveDamage(attacker, WATER_SPECIAL, fire)).toBeCloseTo(base * STAB_MULT * 2, 6);
    expect(estimateMoveDamage(attacker, SHAKY, neutral)).toBeCloseTo(estimateMoveDamage(attacker, NORMAL_PHYSICAL, neutral) / 2, 6);
  });
});

describe('fighterStrength', () => {
  it('floors offence for a status-only set, and is zero with no HP', () => {
    const growler = fighter('g', { moves: [{ moveId: 3, ppRemaining: 40, ppMax: 40 }] });
    const enemy = fighter('e');
    expect(fighterStrength(growler, [enemy], lookup)).toBeCloseTo(Math.sqrt(ODDS_MIN_OFFENSE * 200 * 100), 6);
    expect(fighterStrength(fighter('f', { currentHp: 0 }), [enemy], lookup)).toBe(0);
    // Out of PP counts as no move.
    const empty = fighter('p', { moves: [{ moveId: 2, ppRemaining: 0, ppMax: 35 }] });
    expect(fighterStrength(empty, [enemy], lookup)).toBe(fighterStrength(growler, [enemy], lookup));
  });
});

describe('computeWinOdds', () => {
  it('gives identical fighters identical odds that sum to 1', () => {
    const fighters = ['a', 'b', 'c', 'd'].map((id) => fighter(id));
    const odds = computeWinOdds(stateOf(fighters), lookup, ffa(fighters));
    for (const f of fighters) expect(odds[f.instanceId]).toBeCloseTo(0.25, 9);
  });

  it('favours the type advantage, the fresher fighter, and any real attacker over a status-only one', () => {
    const water = fighter('water', { types: types('water'), moves: [{ moveId: 1, ppRemaining: 15, ppMax: 15 }] });
    const fire = fighter('fire', { types: types('fire') });
    const typed = computeWinOdds(stateOf([water, fire]), lookup, ffa([water, fire]));
    expect(typed.water).toBeGreaterThan(typed.fire);
    expect(typed.water + typed.fire).toBeCloseTo(1, 9);

    const fresh = fighter('fresh');
    const hurt = fighter('hurt', { currentHp: 100 });
    const hp = computeWinOdds(stateOf([fresh, hurt]), lookup, ffa([fresh, hurt]));
    expect(hp.fresh).toBeGreaterThan(hp.hurt);

    const hitter = fighter('hitter');
    const growler = fighter('growler', { moves: [{ moveId: 3, ppRemaining: 40, ppMax: 40 }] });
    const status = computeWinOdds(stateOf([hitter, growler]), lookup, ffa([hitter, growler]));
    expect(status.growler).toBeGreaterThan(0);
    expect(status.hitter).toBeGreaterThan(status.growler);
  });

  it('zeroes a fainted fighter and hands a lone survivor exactly 1', () => {
    const fighters = ['a', 'b', 'c'].map((id) => fighter(id));
    const oneDown = computeWinOdds(stateOf(fighters, ['a', 'b']), lookup, ffa(fighters));
    expect(oneDown.c).toBe(0);
    expect(oneDown.a + oneDown.b).toBeCloseTo(1, 9);
    const survivor = computeWinOdds(stateOf(fighters, ['b']), lookup, ffa(fighters));
    expect(survivor).toEqual({ a: 0, b: 1, c: 0 });
    expect(computeWinOdds(stateOf(fighters, []), lookup, ffa(fighters))).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('sums a side\'s living members in a team match', () => {
    const a1 = fighter('a1', { team: 'teamA' });
    const a2 = fighter('a2', { team: 'teamA' });
    const b1 = fighter('b1', { team: 'teamB' });
    const b2 = fighter('b2', { team: 'teamB' });
    const options = [
      { id: 'teamA', instanceIds: ['a1', 'a2'] },
      { id: 'teamB', instanceIds: ['b1', 'b2'] },
    ];
    const even = computeWinOdds(stateOf([a1, a2, b1, b2]), lookup, options);
    expect(even.teamA).toBeCloseTo(0.5, 9);
    const shortHanded = computeWinOdds(stateOf([a1, a2, b1, b2], ['a1', 'b1', 'b2']), lookup, options);
    expect(shortHanded.teamB).toBeGreaterThan(shortHanded.teamA);
    expect(shortHanded.teamA + shortHanded.teamB).toBeCloseTo(1, 9);
  });
});
