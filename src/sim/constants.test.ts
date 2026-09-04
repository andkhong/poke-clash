import { describe, expect, it } from 'vitest';
import {
  AGGRESSION_TRIGGER_MS,
  AGGRESSIVE_COOLDOWN_MULTIPLIER,
  AGGRESSIVE_SPEED_MULTIPLIER,
  AGGRO_RADIUS,
  AGGRO_RADIUS_AGGRESSIVE,
  BALL_DROP_DURATION_MS,
  BALL_DROP_STAGGER_MS,
  COMBAT_START_DELAY_MS,
  computeIntroDurationMs,
  ENGAGE_RANGE,
  ENGAGE_RANGE_AGGRESSIVE,
  isAggressivePhase,
  isBeforeCombatStart,
  LEASH_MULTIPLIER,
  LEASH_MULTIPLIER_AGGRESSIVE,
  MATCH_TIME_LIMIT_MS,
  RETARGET_INTERVAL_MS,
  RETARGET_INTERVAL_MS_AGGRESSIVE,
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

describe('match clock: 45s aggression trigger / 90s hard cap', () => {
  it('the aggression trigger fires strictly before the hard cap', () => {
    expect(AGGRESSION_TRIGGER_MS).toBeLessThan(MATCH_TIME_LIMIT_MS);
    expect(MATCH_TIME_LIMIT_MS).toBe(90_000);
    expect(AGGRESSION_TRIGGER_MS).toBe(45_000);
  });

  it('isAggressivePhase flips exactly at the trigger, not before', () => {
    expect(isAggressivePhase(AGGRESSION_TRIGGER_MS - 1)).toBe(false);
    expect(isAggressivePhase(AGGRESSION_TRIGGER_MS)).toBe(true);
    expect(isAggressivePhase(MATCH_TIME_LIMIT_MS)).toBe(true);
  });

  it('every aggressive-phase variant is strictly more aggressive than its base value', () => {
    expect(AGGRO_RADIUS_AGGRESSIVE).toBeGreaterThan(AGGRO_RADIUS);
    expect(ENGAGE_RANGE_AGGRESSIVE).toBeGreaterThan(ENGAGE_RANGE);
    expect(LEASH_MULTIPLIER_AGGRESSIVE).toBeGreaterThan(LEASH_MULTIPLIER);
    expect(RETARGET_INTERVAL_MS_AGGRESSIVE).toBeLessThan(RETARGET_INTERVAL_MS); // re-checks target more often
    expect(AGGRESSIVE_SPEED_MULTIPLIER).toBeGreaterThan(1); // faster movement
    expect(AGGRESSIVE_COOLDOWN_MULTIPLIER).toBeLessThan(1); // shorter cooldown = faster attacks
  });
});

describe('isBeforeCombatStart', () => {
  it('is measured from when battle phase starts, not raw match time', () => {
    const introDurationMs = 3000;
    expect(isBeforeCombatStart(introDurationMs, introDurationMs)).toBe(true); // t=0 of battle
    expect(isBeforeCombatStart(introDurationMs + COMBAT_START_DELAY_MS - 1, introDurationMs)).toBe(true);
    expect(isBeforeCombatStart(introDurationMs + COMBAT_START_DELAY_MS, introDurationMs)).toBe(false);
  });

  it('a bigger roster (longer intro) still gets the same combat-free window after its own intro ends', () => {
    const shortIntro = computeIntroDurationMs(2);
    const longIntro = computeIntroDurationMs(16);
    expect(isBeforeCombatStart(longIntro + 1, longIntro)).toBe(true);
    expect(isBeforeCombatStart(shortIntro + COMBAT_START_DELAY_MS + 1, shortIntro)).toBe(false);
  });
});
