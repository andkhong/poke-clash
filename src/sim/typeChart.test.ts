import { describe, expect, it } from 'vitest';
import { getEffectiveness, getTypeMultiplier } from './typeChart';

describe('getTypeMultiplier', () => {
  it('handles classic single-type matchups', () => {
    expect(getTypeMultiplier('water', 'fire')).toBe(2);
    expect(getTypeMultiplier('fire', 'water')).toBe(0.5);
    expect(getTypeMultiplier('electric', 'ground')).toBe(0);
    expect(getTypeMultiplier('normal', 'ghost')).toBe(0);
    expect(getTypeMultiplier('fighting', 'ghost')).toBe(0);
    expect(getTypeMultiplier('fairy', 'dragon')).toBe(2);
    expect(getTypeMultiplier('dragon', 'fairy')).toBe(0);
  });

  it('defaults to neutral (1x) for unlisted pairs', () => {
    expect(getTypeMultiplier('normal', 'water')).toBe(1);
  });

  it('reflects the Gen 6+ chart, not the pre-Fairy chart (Steel no longer resists Ghost/Dark)', () => {
    expect(getTypeMultiplier('ghost', 'steel')).toBe(1);
    expect(getTypeMultiplier('dark', 'steel')).toBe(1);
  });
});

describe('getEffectiveness (dual-type product)', () => {
  it('multiplies across both defending types', () => {
    // Ice vs Dragon/Flying (e.g. Dragonite family): 2 * 2 = 4
    expect(getEffectiveness('ice', ['dragon', 'flying'])).toBe(4);
  });

  it('produces a 0 immunity if either defending type is immune', () => {
    // Ground move vs a Flying/anything dual-type is always immune.
    expect(getEffectiveness('ground', ['flying', 'water'])).toBe(0);
  });

  it('handles single-type defenders', () => {
    expect(getEffectiveness('grass', ['water'])).toBe(2);
  });
});
