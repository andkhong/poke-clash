// Small deterministic PRNG (mulberry32) so a given seed always produces the same
// match. Not used for cross-session replay (out of scope for v1), just keeps the
// engine's own randomness isolated from Math.random for testability.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive-exclusive integer in [min, max). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min)) + min;
}

/** Inclusive integer in [min, max]. */
export function rngIntInclusive(rng: Rng, min: number, max: number): number {
  return rngInt(rng, min, max + 1);
}

export function rngChance(rng: Rng, probability0to1: number): boolean {
  return rng() < probability0to1;
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('rngPick: empty array');
  return items[rngInt(rng, 0, items.length)];
}

/** Fisher-Yates shuffle, returns a new array. */
export function rngShuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
