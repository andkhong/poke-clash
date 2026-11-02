import { describe, expect, it } from 'vitest';
import { moveLookup } from '../data/loader';
import { PLAY_IDS, rollMoves } from './playMode';

const damaging = (id: number) => (moveLookup(id)?.power ?? 0) > 0 && !moveLookup(id)?.userFaints;

describe('Play Mode roster and movesets', () => {
  it('offers Gens 1–4 but leaves out species with no damaging move (Ditto, Kakuna)', () => {
    expect(PLAY_IDS).not.toContain(132);
    expect(PLAY_IDS).not.toContain(14);
    expect(PLAY_IDS).toContain(25);
    expect(PLAY_IDS).toContain(493);
    expect(PLAY_IDS).not.toContain(494);
  });

  it('always rolls at least one damaging move, for every species', () => {
    for (const id of PLAY_IDS) {
      for (let roll = 0; roll < 5; roll++) expect(rollMoves(id).some(damaging), `species ${id}`).toBe(true);
    }
  });
});
