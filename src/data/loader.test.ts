import { describe, expect, it } from 'vitest';
import {
  buildSpeciesDataForLevel,
  buildSpeciesMapForLevel,
  getMoveDefinition,
  listAllSpecies,
  pickRandomSpeciesIds,
} from './loader';

describe('generated dataset', () => {
  it('covers the full National Pokédex through Gen 9 (#1025)', () => {
    const all = listAllSpecies();
    expect(all.length).toBe(1025);
    expect(all.some((s) => s.id === 1 && s.name === 'bulbasaur')).toBe(true);
    expect(all.some((s) => s.id === 1025)).toBe(true);
  });

  it('every species has real, non-empty base stats and at least one type', () => {
    for (const s of listAllSpecies()) {
      const data = buildSpeciesDataForLevel(s.id, 100);
      expect(data).toBeDefined();
      expect(data!.types.length).toBeGreaterThan(0);
      expect(data!.baseStats.hp).toBeGreaterThan(0);
    }
  });

  it('resolves every move referenced in any movePool to a real MoveDefinition', () => {
    for (const s of listAllSpecies()) {
      const data = buildSpeciesDataForLevel(s.id, 100)!;
      for (const moveId of data.movePool) {
        expect(getMoveDefinition(moveId)).toBeDefined();
      }
    }
  });

  it('movePool grows or stays the same as level increases (more level-up moves unlock)', () => {
    // Charizard (#6) has level-up moves spread across a wide level range.
    const at50 = buildSpeciesDataForLevel(6, 50)!;
    const at100 = buildSpeciesDataForLevel(6, 100)!;
    expect(at100.movePool.length).toBeGreaterThanOrEqual(at50.movePool.length);
  });

  it('buildSpeciesMapForLevel keys results by species id', () => {
    const map = buildSpeciesMapForLevel([1, 4, 7], 100);
    expect(Object.keys(map).sort()).toEqual(['1', '4', '7']);
    expect(map[1].name).toBe('bulbasaur');
  });
});

describe('pickRandomSpeciesIds', () => {
  it('returns the requested count of unique ids', () => {
    const ids = pickRandomSpeciesIds(16);
    expect(ids.length).toBe(16);
    expect(new Set(ids).size).toBe(16);
  });

  it('respects the exclude list', () => {
    const ids = pickRandomSpeciesIds(5, [1, 2, 3, 4, 5]);
    for (const id of ids) expect([1, 2, 3, 4, 5]).not.toContain(id);
  });
});
