import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../sim/engine';
import { MATCH_TIME_LIMIT_MS, TICK_MS } from '../sim/constants';
import { buildSpeciesMapForLevel, moveLookup, pickRandomSpeciesIds } from '../data/loader';
import type { SimState } from '../sim/types';
import { LEAN_POKEMON_FIELDS, mergeLeanState, toLeanState } from './leanState';

function withoutPokemon(state: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'pokemon'));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A real 16-Pokémon match: its state at spawn, and after `ms` of play. */
function statesAt(ms: number, seed = 7): { initial: SimState; later: SimState } {
  const speciesIds = pickRandomSpeciesIds(16);
  const engine = new SimulationEngine(
    { level: 50, speciesIds, arena: { width: 1920, height: 1080 }, shiny: false },
    buildSpeciesMapForLevel(speciesIds, 50),
    moveLookup,
    seed
  );
  const initial = clone(engine.getState());
  for (let i = 0; i < Math.ceil(ms / TICK_MS); i++) engine.tick(TICK_MS);
  return { initial, later: clone(engine.getState()) };
}

describe('toLeanState', () => {
  it('keeps exactly the renderer-facing mutable fields of every Pokémon and nothing static', () => {
    const { later } = statesAt(30_000);
    const lean = toLeanState(later);
    expect(Object.keys(lean.pokemon).sort()).toEqual([...later.allInstanceIds].sort());
    for (const id of later.allInstanceIds) {
      const keys = Object.keys(lean.pokemon[id]);
      for (const key of keys) expect(LEAN_POKEMON_FIELDS).toContain(key);
      expect(keys).not.toContain('moves');
      expect(keys).not.toContain('computedStats');
      expect(keys).not.toContain('name');
    }
  });

  it('carries every top-level SimState field through untouched', () => {
    const { later } = statesAt(30_000);
    const lean = toLeanState(later);
    expect(withoutPokemon(lean)).toEqual(withoutPokemon(later));
  });

  it('rounds positions to a tenth of a pixel and copies the other fields verbatim', () => {
    const { later } = statesAt(30_000);
    const lean = toLeanState(later);
    for (const id of later.allInstanceIds) {
      const full = later.pokemon[id];
      const l = lean.pokemon[id];
      expect(Math.abs(l.position.x - full.position.x)).toBeLessThanOrEqual(0.05);
      expect(Math.abs(l.position.y - full.position.y)).toBeLessThanOrEqual(0.05);
      expect(l.currentHp).toBe(full.currentHp);
      expect(l.status).toBe(full.status);
      expect(l.facing).toBe(full.facing);
      expect(l.aiState).toBe(full.aiState);
      expect(l.targetInstanceId).toBe(full.targetInstanceId);
      expect(l.postAttackHoldMs).toBe(full.postAttackHoldMs);
      expect(l.lastHitAtMs).toBe(full.lastHitAtMs);
      expect(l.lastDamagedByInstanceId).toBe(full.lastDamagedByInstanceId);
    }
  });

  it('is a fraction of the full state on the wire', () => {
    const { later } = statesAt(30_000);
    const fullBytes = JSON.stringify(later).length;
    const leanBytes = JSON.stringify(toLeanState(later)).length;
    expect(leanBytes).toBeLessThan(fullBytes * 0.35);
  });
});

describe('mergeLeanState', () => {
  it('lays the update over the spawn snapshot: mutable fields from the update, static ones from the snapshot', () => {
    const { initial, later } = statesAt(30_000);
    const merged = mergeLeanState(initial, toLeanState(later));
    expect(merged.elapsedMs).toBe(later.elapsedMs);
    expect(merged.livingOrder).toEqual(later.livingOrder);
    expect(merged.phase).toBe(later.phase);
    for (const id of later.allInstanceIds) {
      const m = merged.pokemon[id];
      const full = later.pokemon[id];
      expect(m.currentHp).toBe(full.currentHp);
      expect(m.aiState).toBe(full.aiState);
      expect(m.status).toBe(full.status);
      expect(Math.abs(m.position.x - full.position.x)).toBeLessThanOrEqual(0.05);
      // Static fields survive from the snapshot, identical to the live ones.
      expect(m.name).toBe(full.name);
      expect(m.moves.map((s) => s.moveId)).toEqual(full.moves.map((s) => s.moveId));
      expect(m.collisionRadius).toBe(full.collisionRadius);
      expect(m.maxHp).toBe(full.maxHp);
    }
  });

  it('reproduces a finished match end to end through a chain of merges', () => {
    const speciesIds = pickRandomSpeciesIds(6);
    const engine = new SimulationEngine(
      { level: 50, speciesIds, arena: { width: 960, height: 1600 }, shiny: false },
      buildSpeciesMapForLevel(speciesIds, 50),
      moveLookup,
      3
    );
    let client = clone(engine.getState());
    const maxSteps = Math.ceil((MATCH_TIME_LIMIT_MS + 5_000) / TICK_MS);
    for (let i = 0; i < maxSteps && engine.getState().phase !== 'complete'; i++) {
      engine.tick(TICK_MS);
      if (i % 2 === 0) client = mergeLeanState(client, clone(toLeanState(engine.getState())));
    }
    client = mergeLeanState(client, clone(toLeanState(engine.getState())));
    const server = engine.getState();
    expect(client.phase).toBe('complete');
    expect(client.winnerInstanceIds).toEqual(server.winnerInstanceIds);
    expect(client.eliminationOrder).toEqual(server.eliminationOrder);
    for (const id of server.allInstanceIds) {
      expect(client.pokemon[id].currentHp).toBe(server.pokemon[id].currentHp);
      expect(client.pokemon[id].lastDamagedByInstanceId).toBe(server.pokemon[id].lastDamagedByInstanceId);
    }
  });

  it('accepts a full SimState as the update (a server still sending full states) and yields exactly it', () => {
    const { initial, later } = statesAt(30_000);
    expect(mergeLeanState(initial, later)).toEqual(later);
  });

  it('ignores a Pokémon the snapshot never had instead of admitting a half-built record', () => {
    const { initial, later } = statesAt(30_000);
    const lean = toLeanState(later);
    lean.pokemon['ghost-999'] = lean.pokemon[later.allInstanceIds[0]];
    const merged = mergeLeanState(initial, lean);
    expect(merged.pokemon['ghost-999']).toBeUndefined();
  });
});
