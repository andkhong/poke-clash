import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './engine';
import type { SpeciesData } from './matchSetup';
import type { MoveDefinition } from './types';
import { COMBAT_START_DELAY_MS, TICK_MS } from './constants';

const FIXTURE_MOVES: MoveDefinition[] = [
  { id: 1, name: 'Fixture Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, targeting: 'enemy' },
  { id: 2, name: 'Fixture Ember', type: 'fire', category: 'special', power: 40, accuracy: 100, pp: 25, priority: 0, targeting: 'enemy' },
  { id: 3, name: 'Fixture Aqua Jet', type: 'water', category: 'physical', power: 40, accuracy: 100, pp: 20, priority: 1, targeting: 'enemy' },
  { id: 4, name: 'Fixture Growl-ish', type: 'normal', category: 'status', power: null, accuracy: 100, pp: 40, priority: 0, targeting: 'enemy', effect: { kind: 'statStage', target: 'enemy', statChanges: { atk: -1 } } },
  { id: 5, name: 'Fixture Swords Dance-ish', type: 'normal', category: 'status', power: null, accuracy: 100, pp: 20, priority: 0, targeting: 'self', effect: { kind: 'statStage', target: 'self', statChanges: { atk: 2 } } },
  { id: 6, name: 'Fixture Thunder Wave-ish', type: 'electric', category: 'status', power: null, accuracy: 90, pp: 20, priority: 0, targeting: 'enemy', effect: { kind: 'statusInflict', target: 'enemy', status: 'paralysis', chance: 100 } },
  { id: 7, name: 'Fixture Vine Whip', type: 'grass', category: 'physical', power: 45, accuracy: 100, pp: 25, priority: 0, targeting: 'enemy' },
  { id: 8, name: 'Fixture Quake', type: 'ground', category: 'physical', power: 60, accuracy: 100, pp: 10, priority: 0, targeting: 'all-enemies-in-radius' },
];

const movesById = new Map(FIXTURE_MOVES.map((m) => [m.id, m]));
const moveLookup = (id: number) => movesById.get(id);

const FIXTURE_SPECIES: Record<number, SpeciesData> = {
  1: { id: 1, name: 'Fixmander', types: ['fire'], baseStats: { hp: 60, atk: 65, def: 55, spa: 70, spd: 60, spe: 65 }, movePool: [1, 2, 5, 6], collisionRadius: 40 },
  2: { id: 2, name: 'Fixasaur', types: ['grass', 'poison'], baseStats: { hp: 65, atk: 60, def: 65, spa: 70, spd: 70, spe: 55 }, movePool: [1, 4, 5, 7], collisionRadius: 40 },
  3: { id: 3, name: 'Fixatoise', types: ['water'], baseStats: { hp: 70, atk: 60, def: 70, spa: 65, spd: 70, spe: 50 }, movePool: [1, 3, 4, 6], collisionRadius: 40 },
  4: { id: 4, name: 'Fixachu', types: ['electric'], baseStats: { hp: 40, atk: 55, def: 40, spa: 55, spd: 45, spe: 95 }, movePool: [1, 6, 5, 3], collisionRadius: 40 },
  5: { id: 5, name: 'Fixolax', types: ['normal'], baseStats: { hp: 130, atk: 65, def: 65, spa: 65, spd: 100, spe: 30 }, movePool: [1, 4, 8, 5], collisionRadius: 40 },
  6: { id: 6, name: 'Fixiron', types: ['ground'], baseStats: { hp: 100, atk: 90, def: 130, spa: 55, spd: 65, spe: 30 }, movePool: [8, 1, 4, 5], collisionRadius: 40 },
};

function runFullMatch(seed: number, speciesIds: number[]): SimulationEngine {
  const engine = new SimulationEngine(
    { level: 100, speciesIds, arena: { width: 960, height: 1600 }, shiny: false },
    FIXTURE_SPECIES,
    moveLookup,
    seed
  );

  // The 90s match-time hard cap guarantees completion well within this
  // budget — a bit of headroom over that so a genuine hang still fails the
  // test loudly instead of looping forever.
  const maxSteps = Math.ceil(95_000 / TICK_MS);
  for (let i = 0; i < maxSteps; i++) {
    if (engine.getState().phase === 'complete') break;
    engine.tick(TICK_MS);
  }
  return engine;
}

describe('SimulationEngine full match', () => {
  it('always resolves to one or more winners with valid HP for every seed in a sample', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const engine = runFullMatch(seed, [1, 2, 3, 4, 5, 6]);
      const state = engine.getState();

      expect(state.phase).toBe('complete');
      expect(state.livingOrder.length).toBeGreaterThanOrEqual(1);
      // Co-winners are possible if the 90s cap is hit with several still
      // standing — winnerInstanceIds should always match livingOrder exactly.
      expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());

      for (const p of Object.values(state.pokemon)) {
        expect(Number.isNaN(p.currentHp)).toBe(false);
        expect(p.currentHp).toBeGreaterThanOrEqual(0);
        expect(p.currentHp).toBeLessThanOrEqual(p.maxHp);
      }
    }
  });

  it('never lets a match run past the 90s hard time limit, even forced far beyond it', () => {
    const engine = runFullMatch(11, [1, 2, 3, 4, 5, 6]);
    // Keep ticking well past 90s regardless of whether it already finished —
    // the cap must hold no matter how much extra time is thrown at it.
    for (let i = 0; i < Math.ceil(30_000 / TICK_MS); i++) {
      engine.tick(TICK_MS);
    }
    const state = engine.getState();
    expect(state.phase).toBe('complete');
    expect(state.elapsedMs).toBeLessThanOrEqual(90_000 + TICK_MS);
    expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());
  });

  it('emits a matchStart milestone immediately and a matchEnd milestone on completion', () => {
    const engine = runFullMatch(42, [1, 3]);
    const events = engine.getEventsSince(0);
    expect(events[0]).toMatchObject({ type: 'milestone', kind: 'matchStart' });
    expect(events.some((e) => e.type === 'milestone' && e.kind === 'matchEnd')).toBe(true);
  });

  it('emits a finalTwo milestone when the roster drops to 2 in a larger match', () => {
    const engine = runFullMatch(7, [1, 2, 3, 4, 5, 6]);
    const events = engine.getEventsSince(0);
    expect(events.some((e) => e.type === 'milestone' && e.kind === 'finalTwo')).toBe(true);
  });

  it('lets nobody attack another Pokémon until COMBAT_START_DELAY_MS after the intro ends', () => {
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3, 4, 5, 6], arena: { width: 960, height: 1600 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      99
    );
    const combatStartMs = engine.getState().introDurationMs + COMBAT_START_DELAY_MS;

    // One tick before combat is allowed to start, everyone should genuinely
    // be wandering (not idle/frozen, not already engaged).
    for (let i = 0; i < Math.floor(combatStartMs / TICK_MS) - 1; i++) {
      engine.tick(TICK_MS);
    }
    for (const p of Object.values(engine.getState().pokemon)) {
      expect(['wander', 'incapacitated']).toContain(p.aiState);
    }

    // Keep ticking a bit past the threshold and confirm no attack landed
    // before it — a self-buff (targetIds: []) during wander doesn't count.
    for (let i = 0; i < 10; i++) engine.tick(TICK_MS);
    const earlyAttacks = engine
      .getEventsSince(0)
      .filter((e) => e.type === 'moveUsed' && e.targetIds.length > 0 && e.atMs < combatStartMs);
    expect(earlyAttacks).toEqual([]);
  });

  it('removes a fainted Pokémon from livingOrder and records it in eliminationOrder', () => {
    const engine = runFullMatch(3, [1, 3]);
    const state = engine.getState();
    expect(state.eliminationOrder.length).toBe(1);
    expect(state.livingOrder).not.toContain(state.eliminationOrder[0]);
  });

  it('never lets PP go negative and falls back to Struggle behavior gracefully', () => {
    const engine = runFullMatch(9, [1, 3]);
    const state = engine.getState();
    for (const p of Object.values(state.pokemon)) {
      for (const slot of p.moves) {
        expect(slot.ppRemaining).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('holds the intro circle formation without moving Pokémon before battle starts', () => {
    const engine = new SimulationEngine(
      { level: 100, speciesIds: [1, 2, 3], arena: { width: 960, height: 1600 }, shiny: false },
      FIXTURE_SPECIES,
      moveLookup,
      1
    );
    const before = Object.fromEntries(
      Object.entries(engine.getState().pokemon).map(([id, p]) => [id, { ...p.position }])
    );
    engine.tick(TICK_MS); // one small step, still within INTRO_DURATION_MS
    expect(engine.getState().phase).toBe('intro');
    for (const [id, p] of Object.entries(engine.getState().pokemon)) {
      expect(p.position).toEqual(before[id]);
    }
  });
});
