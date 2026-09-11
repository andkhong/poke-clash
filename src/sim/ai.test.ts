import { describe, expect, it } from 'vitest';
import { chooseMove, findSelfBuffMove, pickWeightedRandomTarget, updateTargeting } from './ai';
import { createRng } from './rng';
import { AGGRO_RADIUS, COMBAT_START_DELAY_MS, ENGAGE_RANGE, NO_WANDER_AGGRO_RADIUS, SELF_KO_MOVE_HP_FRACTION, TICK_MS } from './constants';
import { STRUGGLE_MOVE_ID } from './struggle';
import type { MoveDefinition, PokemonInstance, SimState, Vec2 } from './types';

function makePokemon(
  id: string,
  team: string,
  x: number,
  y: number,
  overrides: Partial<PokemonInstance> = {}
): PokemonInstance {
  return {
    instanceId: id,
    speciesId: 1,
    name: 'Test',
    level: 100,
    types: ['normal'],
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    computedStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    statStages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    currentHp: 100,
    maxHp: 100,
    moves: [],
    status: null,
    statusTickAccumMs: 0,
    position: { x, y },
    velocity: { x: 0, y: 0 },
    facing: 'S',
    collisionRadius: 40,
    team,
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    postAttackHoldMs: 0,
    shiny: false,
    ...overrides,
  };
}

function makeState(pokemonList: PokemonInstance[], introDurationMs = 0): SimState {
  const pokemon = Object.fromEntries(pokemonList.map((p) => [p.instanceId, p]));
  const ids = pokemonList.map((p) => p.instanceId);
  return {
    tick: 0,
    elapsedMs: 0,
    pokemon,
    allInstanceIds: ids,
    livingOrder: ids,
    eliminationOrder: [],
    phase: 'battle',
    winnerInstanceIds: [],
    arena: { width: 2000, height: 2000 },
    introDurationMs,
    attackGate: { active: [], closedUntilMs: 0, lastAttackerId: null },
  };
}

function positionsOf(pokemonList: PokemonInstance[]): Map<string, Vec2> {
  return new Map(pokemonList.map((p) => [p.instanceId, { ...p.position }]));
}

// Comfortably past both the intro's COMBAT_START_DELAY_MS grace window and
// well short of the 45s aggressive-phase trigger, so every test below
// exercises the normal-phase constants deterministically.
const NOW_MS = COMBAT_START_DELAY_MS + 10_000;

describe('updateTargeting — wander-after-attack', () => {
  it('stays in wander while on cooldown, even with a valid target already in engage range', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      actionCooldownMs: 500,
      targetInstanceId: 'enemy',
      aiState: 'attack',
    });
    const enemy = makePokemon('enemy', 'b', 10, 10); // well within ENGAGE_RANGE
    const state = makeState([self, enemy]);

    updateTargeting(self, state, positionsOf([self, enemy]), NOW_MS, createRng(1));

    expect(self.aiState).toBe('wander');
  });

  it('decrements actionCooldownMs by one tick, same cadence as before it moved here', () => {
    const self = makePokemon('self', 'a', 0, 0, { actionCooldownMs: 500 });
    const state = makeState([self]);

    updateTargeting(self, state, positionsOf([self]), NOW_MS, createRng(1));

    expect(self.actionCooldownMs).toBe(500 - TICK_MS);
  });

  it('resolves attack vs chase correctly once cooldown has already reached 0', () => {
    const near = makePokemon('near', 'a', 0, 0, { targetInstanceId: 'enemy' });
    const enemyNear = makePokemon('enemy', 'b', 10, 10); // within ENGAGE_RANGE
    updateTargeting(near, makeState([near, enemyNear]), positionsOf([near, enemyNear]), NOW_MS, createRng(1));
    expect(near.aiState).toBe('attack');

    const far = makePokemon('far', 'a', 0, 0, { targetInstanceId: 'enemy' });
    const enemyFar = makePokemon('enemy', 'b', ENGAGE_RANGE + 50, 0); // outside ENGAGE_RANGE, inside AGGRO_RADIUS
    updateTargeting(far, makeState([far, enemyFar]), positionsOf([far, enemyFar]), NOW_MS, createRng(1));
    expect(far.aiState).toBe('chase');
  });
});

describe('updateTargeting — a wander leg is walked to its end', () => {
  it('stays in wander until it reaches its waypoint, even off cooldown with an enemy right in engage range', () => {
    const self = makePokemon('self', 'a', 0, 0, { wanderWaypoint: { x: 500, y: 0 } });
    const enemy = makePokemon('enemy', 'b', 10, 10);
    updateTargeting(self, makeState([self, enemy]), positionsOf([self, enemy]), NOW_MS, createRng(1));
    expect(self.aiState).toBe('wander');
    expect(self.wanderWaypoint).toEqual({ x: 500, y: 0 }); // the leg is still on
  });

  it('engages the moment the leg is done, clearing the waypoint and taking a fresh look at targets', () => {
    // Arrived (within WANDER_ARRIVAL_DISTANCE of the waypoint), with a stale
    // target set and the periodic retarget timer nowhere near due — arriving
    // is itself a retarget trigger, so the closer enemy is picked up.
    const self = makePokemon('self', 'a', 0, 0, {
      wanderWaypoint: { x: 5, y: 0 },
      targetInstanceId: 'staleTarget',
      lastRetargetMs: NOW_MS - 100,
    });
    const staleTarget = makePokemon('staleTarget', 'b', AGGRO_RADIUS + 80, 0); // outside radius, not a candidate
    const closerEnemy = makePokemon('closerEnemy', 'b', 10, 10);
    const list = [self, staleTarget, closerEnemy];
    updateTargeting(self, makeState(list), positionsOf(list), NOW_MS, createRng(1));
    expect(self.wanderWaypoint).toBeUndefined();
    expect(self.targetInstanceId).toBe('closerEnemy');
    expect(self.aiState).toBe('attack');
  });

  it('never makes a paralyzed Pokémon wait out a leg it cannot walk', () => {
    // stepMovement holds a paralyzed wanderer in place, so a leg would never
    // end — it has to be able to engage regardless.
    const self = makePokemon('self', 'a', 0, 0, { status: 'paralysis', wanderWaypoint: { x: 500, y: 0 } });
    const enemy = makePokemon('enemy', 'b', 10, 10);
    updateTargeting(self, makeState([self, enemy]), positionsOf([self, enemy]), NOW_MS, createRng(1));
    expect(self.aiState).toBe('attack');
  });

  it('is skipped entirely under disableWander', () => {
    const self = makePokemon('self', 'a', 0, 0, { wanderWaypoint: { x: 500, y: 0 } });
    const enemy = makePokemon('enemy', 'b', 10, 10);
    const state: SimState = { ...makeState([self, enemy]), disableWander: true };
    updateTargeting(self, state, positionsOf([self, enemy]), NOW_MS, createRng(1));
    expect(self.aiState).toBe('attack');
  });
});

describe('updateTargeting — cooldown-expiry reacquire (anti stale-lock)', () => {
  it('reacquires the moment cooldown hits 0, even though the old target is still alive, in leash, and the periodic timer has not elapsed', () => {
    // Old target has drifted just outside AGGRO_RADIUS (320) but still well
    // within the leash (320 * 1.5 = 480) — so neither the "too far" nor the
    // "periodic timer" trigger would fire on their own. A closer enemy is
    // freshly within AGGRO_RADIUS. Without the justBecameAvailable trigger,
    // a fast Pokémon coming off a short cooldown would just keep re-attacking
    // the same stale target forever; with it, this reacquires deterministically
    // (the stale target isn't even a candidate, since it's outside the radius).
    const self = makePokemon('self', 'a', 0, 0, {
      actionCooldownMs: TICK_MS, // about to hit exactly 0 this call
      targetInstanceId: 'staleTarget',
      lastRetargetMs: NOW_MS - 100, // recent — RETARGET_INTERVAL_MS (2000ms) hasn't elapsed
    });
    const staleTarget = makePokemon('staleTarget', 'b', AGGRO_RADIUS + 80, 0); // 400px — outside radius, inside leash
    const closerEnemy = makePokemon('closerEnemy', 'b', 150, 0); // inside AGGRO_RADIUS
    const state = makeState([self, staleTarget, closerEnemy]);

    updateTargeting(self, state, positionsOf([self, staleTarget, closerEnemy]), NOW_MS, createRng(1));

    expect(self.targetInstanceId).toBe('closerEnemy');
  });

  it('does NOT reacquire mid-cooldown just because a closer enemy exists (only the cooldown-expiry tick triggers it)', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      actionCooldownMs: 5 * TICK_MS, // nowhere near expiring
      targetInstanceId: 'staleTarget',
      lastRetargetMs: NOW_MS - 100,
    });
    const staleTarget = makePokemon('staleTarget', 'b', AGGRO_RADIUS + 80, 0);
    const closerEnemy = makePokemon('closerEnemy', 'b', 150, 0);
    const state = makeState([self, staleTarget, closerEnemy]);

    updateTargeting(self, state, positionsOf([self, staleTarget, closerEnemy]), NOW_MS, createRng(1));

    // Still cooling down -> forced wander, target bookkeeping untouched.
    expect(self.aiState).toBe('wander');
    expect(self.targetInstanceId).toBe('staleTarget');
  });
});

describe('pickWeightedRandomTarget', () => {
  it('never returns an ally, only enemies within radius', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const ally = makePokemon('ally', 'a', 10, 10);
    const enemy = makePokemon('enemy', 'b', 20, 20);
    const state = makeState([self, ally, enemy]);
    const rng = createRng(1);

    for (let i = 0; i < 20; i++) {
      const picked = pickWeightedRandomTarget(self, state, positionsOf([self, ally, enemy]), AGGRO_RADIUS, rng);
      expect(picked?.instanceId).toBe('enemy');
    }
  });

  it('returns null when nothing is within radius', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const farEnemy = makePokemon('enemy', 'b', AGGRO_RADIUS + 500, 0);
    const state = makeState([self, farEnemy]);

    expect(pickWeightedRandomTarget(self, state, positionsOf([self, farEnemy]), AGGRO_RADIUS, createRng(1))).toBeNull();
  });

  it('biases toward the closer of two in-radius candidates, but still picks the farther one sometimes', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const closeEnemy = makePokemon('close', 'b', 50, 0); // weight = radius - 50
    const farEnemy = makePokemon('far', 'b', 250, 0); // weight = radius - 250, still > 0
    const state = makeState([self, closeEnemy, farEnemy]);
    const positions = positionsOf([self, closeEnemy, farEnemy]);
    const rng = createRng(42);

    let closeCount = 0;
    let farCount = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const picked = pickWeightedRandomTarget(self, state, positions, AGGRO_RADIUS, rng);
      if (picked?.instanceId === 'close') closeCount++;
      else if (picked?.instanceId === 'far') farCount++;
    }

    // Expected ratio from the linear weight formula: (320-50) : (320-250) = 270 : 70 ≈ 79.4% close.
    expect(closeCount / trials).toBeGreaterThan(0.65);
    expect(closeCount / trials).toBeLessThan(0.9);
    // The core "not solely focus on a specific pokemon" guarantee: the farther
    // candidate must have a real, nonzero chance, not just theoretical.
    expect(farCount).toBeGreaterThan(0);
  });

  it('is deterministic given the same seed', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const enemies = [
      makePokemon('e1', 'b', 40, 0),
      makePokemon('e2', 'b', 120, 60),
      makePokemon('e3', 'b', 200, -40),
    ];
    const state = makeState([self, ...enemies]);
    const positions = positionsOf([self, ...enemies]);

    const runOnce = (seed: number) => {
      const rng = createRng(seed);
      const picks: string[] = [];
      for (let i = 0; i < 30; i++) {
        picks.push(pickWeightedRandomTarget(self, state, positions, AGGRO_RADIUS, rng)?.instanceId ?? 'none');
      }
      return picks;
    };

    expect(runOnce(777)).toEqual(runOnce(777));
  });
});

describe('updateTargeting — disableWander (MatchConfig.disableWander)', () => {
  it('skips the cold-open wander gate and engages immediately, even before COMBAT_START_DELAY_MS has elapsed', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const enemy = makePokemon('enemy', 'b', 10, 10); // within ENGAGE_RANGE
    // introDurationMs = 0, nowMs = 0 -> normally deep inside the cold-open window.
    const state: SimState = { ...makeState([self, enemy], 0), disableWander: true };

    updateTargeting(self, state, positionsOf([self, enemy]), 0, createRng(1));

    expect(self.aiState).toBe('attack');
  });

  it('skips the cooldown-forces-wander branch, resolving attack/chase from distance instead', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      actionCooldownMs: 500,
      targetInstanceId: 'enemy',
      aiState: 'attack',
    });
    const enemy = makePokemon('enemy', 'b', 10, 10); // within ENGAGE_RANGE
    const state: SimState = { ...makeState([self, enemy]), disableWander: true };

    updateTargeting(self, state, positionsOf([self, enemy]), NOW_MS, createRng(1));

    // Same fixture as the very first wander-after-attack test above (which
    // asserts 'wander' without disableWander) — this is its mirror image.
    expect(self.aiState).toBe('attack');
  });

  it('finds a target well beyond the normal AGGRO_RADIUS, via NO_WANDER_AGGRO_RADIUS', () => {
    const self = makePokemon('self', 'a', 0, 0);
    const farEnemy = makePokemon('enemy', 'b', AGGRO_RADIUS + 5000, 0);
    expect(AGGRO_RADIUS + 5000).toBeLessThan(NO_WANDER_AGGRO_RADIUS); // sanity: fixture actually exercises the widened radius
    const state: SimState = { ...makeState([self, farEnemy]), disableWander: true };

    updateTargeting(self, state, positionsOf([self, farEnemy]), NOW_MS, createRng(1));

    expect(self.targetInstanceId).toBe('enemy');
    expect(self.aiState).toBe('chase'); // found it, but still outside ENGAGE_RANGE
  });
});

describe('chooseMove — forcedMoveId (MatchConfig.forcedMoveId)', () => {
  it('always returns the forced move, regardless of rng seed', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      moves: [
        { moveId: 1, ppRemaining: 10, ppMax: 10 },
        { moveId: 2, ppRemaining: 10, ppMax: 10 },
        { moveId: 3, ppRemaining: 10, ppMax: 10 },
      ],
      forcedMoveId: 2,
    });

    for (let seed = 1; seed <= 20; seed++) {
      expect(chooseMove(self, createRng(seed))).toBe(2);
    }
  });

  it('keeps returning the forced move even at 0 PP, never falling back to Struggle', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      moves: [{ moveId: 1, ppRemaining: 0, ppMax: 10 }],
      forcedMoveId: 1,
    });

    expect(chooseMove(self, createRng(1))).toBe(1);
  });

  it('falls back to the normal random pick if forcedMoveId names a move not actually equipped', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      moves: [{ moveId: 1, ppRemaining: 10, ppMax: 10 }],
      forcedMoveId: 999, // not in moves
    });

    expect(chooseMove(self, createRng(1))).toBe(1);
  });

  it('falls back to Struggle when unset and every move is out of PP (unaffected baseline)', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      moves: [{ moveId: 1, ppRemaining: 0, ppMax: 10 }],
    });

    expect(chooseMove(self, createRng(1))).toBe(STRUGGLE_MOVE_ID);
  });
});

describe('chooseMove — self-KO moves (MoveDefinition.userFaints)', () => {
  const ordinary = (id: number): MoveDefinition => ({ id, name: `Fixture ${id}`, type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, targeting: 'enemy' });
  const lookup = (id: number): MoveDefinition | undefined => (id === 2 ? { ...ordinary(2), name: 'Fixture Explosion', power: 250, userFaints: true } : ordinary(id));
  const slots = () => [
    { moveId: 1, ppRemaining: 10, ppMax: 10 },
    { moveId: 2, ppRemaining: 10, ppMax: 10 },
  ];

  it('never picks the self-KO move while the user is healthy', () => {
    const self = makePokemon('self', 'a', 0, 0, { moves: slots(), currentHp: 100, maxHp: 100 });
    for (let seed = 1; seed <= 40; seed++) expect(chooseMove(self, createRng(seed), lookup)).toBe(1);
  });

  it('puts it back on the table once the user is at or under SELF_KO_MOVE_HP_FRACTION of its HP', () => {
    const self = makePokemon('self', 'a', 0, 0, { moves: slots(), currentHp: Math.floor(100 * SELF_KO_MOVE_HP_FRACTION), maxHp: 100 });
    const picks = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) picks.add(chooseMove(self, createRng(seed), lookup));
    expect(picks).toEqual(new Set([1, 2]));
  });

  it('uses it when nothing else has PP left, rather than Struggling', () => {
    const self = makePokemon('self', 'a', 0, 0, {
      moves: [
        { moveId: 1, ppRemaining: 0, ppMax: 10 },
        { moveId: 2, ppRemaining: 10, ppMax: 10 },
      ],
    });
    expect(chooseMove(self, createRng(1), lookup)).toBe(2);
  });

  it('treats every move as ordinary without a definition lookup (unaffected baseline)', () => {
    const self = makePokemon('self', 'a', 0, 0, { moves: slots() });
    const picks = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) picks.add(chooseMove(self, createRng(seed)));
    expect(picks).toEqual(new Set([1, 2]));
  });
});

describe('findSelfBuffMove — a buff that can no longer raise anything is skipped', () => {
  const swordsDance: MoveDefinition = {
    id: 14,
    name: 'Swords Dance',
    type: 'normal',
    category: 'status',
    power: null,
    accuracy: null,
    pp: 20,
    priority: 0,
    targeting: 'self',
    effect: { kind: 'statStage', target: 'self', statChanges: { atk: 2 }, chance: 100 },
  };
  const lookup = (id: number): MoveDefinition | undefined => (id === 14 ? swordsDance : undefined);
  const slots = () => [{ moveId: 14, ppRemaining: 10, ppMax: 20 }];

  it('offers the buff while the stat it raises is still under its cap', () => {
    const self = makePokemon('self', 'a', 0, 0, { moves: slots() });
    self.statStages.atk = 4;
    expect(findSelfBuffMove(self, lookup)?.id).toBe(14);
  });

  it('withholds it once every stage it changes is already at its cap', () => {
    // Otherwise it keeps spending PP and the arena-wide attack slot on a
    // move that changes nothing, on every chase, for the rest of the match.
    const self = makePokemon('self', 'a', 0, 0, { moves: slots() });
    self.statStages.atk = 6;
    expect(findSelfBuffMove(self, lookup)).toBeUndefined();
  });

  it('still offers a mixed buff while any one of its changes can land', () => {
    const dragonDance: MoveDefinition = { ...swordsDance, id: 349, name: 'Dragon Dance', effect: { kind: 'statStage', target: 'self', statChanges: { atk: 1, spe: 1 }, chance: 100 } };
    const self = makePokemon('self', 'a', 0, 0, { moves: [{ moveId: 349, ppRemaining: 10, ppMax: 20 }] });
    self.statStages.atk = 6;
    self.statStages.spe = 5;
    expect(findSelfBuffMove(self, (id) => (id === 349 ? dragonDance : undefined))?.id).toBe(349);
  });
});
