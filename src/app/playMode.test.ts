import { describe, expect, it } from 'vitest';
import { moveLookup } from '../data/loader';
import { KANTO_IDS, rollMoves } from './playMode';

const damaging = (id: number) => (moveLookup(id)?.power ?? 0) > 0 && !moveLookup(id)?.userFaints;

describe('Play Mode roster and movesets', () => {
  it('leaves out species with no damaging move (Ditto, Kakuna)', () => {
    expect(KANTO_IDS).not.toContain(132);
    expect(KANTO_IDS).not.toContain(14);
    expect(KANTO_IDS).toContain(25);
  });

  it('always rolls at least one damaging move, for every species', () => {
    for (const id of KANTO_IDS) {
      for (let roll = 0; roll < 5; roll++) expect(rollMoves(id).some(damaging), `species ${id}`).toBe(true);
    }
  });
});
