import { describe, expect, it } from 'vitest';
import {
  BALL_DROP_DURATION_MS,
  BALL_DROP_STAGGER_MS,
  computeIntroDurationMs,
} from './constants';

describe('computeIntroDurationMs', () => {
  it('grows with roster size (more Pokémon needs a longer staggered drop)', () => {
    expect(computeIntroDurationMs(2)).toBeLessThan(computeIntroDurationMs(16));
  });

  it('always leaves headroom after the last staggered ball finishes dropping', () => {
    for (const rosterSize of [2, 6, 10, 16]) {
      const lastBallLandsAt = (rosterSize - 1) * BALL_DROP_STAGGER_MS + BALL_DROP_DURATION_MS;
      expect(computeIntroDurationMs(rosterSize)).toBeGreaterThan(lastBallLandsAt);
    }
  });
});
