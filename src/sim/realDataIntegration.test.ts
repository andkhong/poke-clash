import { describe, expect, it } from 'vitest';
import { SimulationEngine } from './engine';
import { TICK_MS } from './constants';
import { buildSpeciesMapForLevel, listAllSpecies, moveLookup, pickRandomSpeciesIds } from '../data/loader';

function runFullMatch(seed: number, speciesIds: number[], level: 50 | 60 | 70 | 80 | 90 | 100): SimulationEngine {
  const species = buildSpeciesMapForLevel(speciesIds, level);
  const engine = new SimulationEngine(
    { level, speciesIds, arena: { width: 960, height: 1600 }, shiny: false },
    species,
    moveLookup,
    seed
  );

  // The 90s match-time hard cap guarantees completion well within this budget.
  const maxSteps = Math.ceil(95_000 / TICK_MS);
  for (let i = 0; i < maxSteps; i++) {
    if (engine.getState().phase === 'complete') break;
    engine.tick(TICK_MS);
  }
  return engine;
}

describe('end-to-end: real PokeAPI-derived dataset through a full 16-Pokémon match', () => {
  it('resolves to one or more winners with no invalid state, across several random rosters/levels/seeds', () => {
    const levels: (50 | 60 | 70 | 80 | 90 | 100)[] = [50, 100];
    for (let i = 0; i < 5; i++) {
      const speciesIds = pickRandomSpeciesIds(16);
      const level = levels[i % levels.length];
      const engine = runFullMatch(1000 + i, speciesIds, level);
      const state = engine.getState();

      expect(state.phase).toBe('complete');
      // Co-winners are possible if the 90s hard time limit is hit with
      // several Pokémon still standing, rather than a clean last-one-standing.
      expect(state.livingOrder.length).toBeGreaterThanOrEqual(1);
      expect(state.eliminationOrder.length).toBe(16 - state.livingOrder.length);
      expect([...state.winnerInstanceIds].sort()).toEqual([...state.livingOrder].sort());

      for (const p of Object.values(state.pokemon)) {
        expect(Number.isNaN(p.currentHp)).toBe(false);
        expect(p.currentHp).toBeGreaterThanOrEqual(0);
        expect(p.currentHp).toBeLessThanOrEqual(p.maxHp);
        expect(p.level).toBe(level);
      }
    }
  });

  it('handles the classic Kanto starters + favorites roster from the example videos', () => {
    const byName = new Map(listAllSpecies().map((s) => [s.name, s.id]));
    const speciesIds = ['pikachu', 'lapras', 'snorlax', 'venusaur', 'charizard', 'blastoise']
      .map((n) => byName.get(n)!)
      .filter((id): id is number => id !== undefined);
    expect(speciesIds.length).toBe(6);

    const engine = runFullMatch(42, speciesIds, 50);
    expect(engine.getState().phase).toBe('complete');
    expect(engine.getState().livingOrder.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a legendary-only roster (very high base stats, often sparse level-up movesets)', () => {
    const byName = new Map(listAllSpecies().map((s) => [s.name, s.id]));
    const speciesIds = ['ho-oh', 'lugia', 'groudon', 'kyogre', 'rayquaza', 'giratina']
      .map((n) => byName.get(n))
      .filter((id): id is number => id !== undefined);
    expect(speciesIds.length).toBeGreaterThanOrEqual(4);

    const engine = runFullMatch(7, speciesIds, 100);
    expect(engine.getState().phase).toBe('complete');
  });
});
