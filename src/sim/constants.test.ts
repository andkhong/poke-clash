import { describe, expect, it } from 'vitest';
import {
  AGGRESSION_TRIGGER_MS,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DESKTOP_ARENA_HEIGHT,
  DESKTOP_ARENA_WIDTH,
  WIDE_ARENA_MAP,
  getFenceInsets,
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

describe('getFenceInsets (the wide map\'s fence as the landscape arena\'s border)', () => {
  it('is zero on every side of the portrait arena, which has no fence', () => {
    expect(getFenceInsets({ width: ARENA_WIDTH, height: ARENA_HEIGHT })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('scales the fence measured off the image straight onto the desktop arena (same 16:9, nothing cropped)', () => {
    const scale = DESKTOP_ARENA_WIDTH / WIDE_ARENA_MAP.width;
    expect(DESKTOP_ARENA_HEIGHT / WIDE_ARENA_MAP.height).toBeCloseTo(scale);
    const insets = getFenceInsets({ width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT });
    expect(insets.left).toBeCloseTo(WIDE_ARENA_MAP.fence.left * scale);
    expect(insets.top).toBeCloseTo(WIDE_ARENA_MAP.fence.top * scale);
    expect(insets.right).toBeCloseTo(DESKTOP_ARENA_WIDTH - WIDE_ARENA_MAP.fence.right * scale);
    expect(insets.bottom).toBeCloseTo(DESKTOP_ARENA_HEIGHT - WIDE_ARENA_MAP.fence.bottom * scale);
  });

  it('keeps the same proportions on the Custom Battle small/tiny scalings of the desktop arena', () => {
    const full = getFenceInsets({ width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT });
    for (const factor of [0.7, 0.45]) {
      const arena = { width: Math.round(DESKTOP_ARENA_WIDTH * factor), height: Math.round(DESKTOP_ARENA_HEIGHT * factor) };
      const insets = getFenceInsets(arena);
      // Rounding the arena to whole pixels shifts each line by under a pixel.
      expect(insets.left / arena.width).toBeCloseTo(full.left / DESKTOP_ARENA_WIDTH, 2);
      expect(insets.right / arena.width).toBeCloseTo(full.right / DESKTOP_ARENA_WIDTH, 2);
      expect(insets.top / arena.height).toBeCloseTo(full.top / DESKTOP_ARENA_HEIGHT, 2);
      expect(insets.bottom / arena.height).toBeCloseTo(full.bottom / DESKTOP_ARENA_HEIGHT, 2);
    }
  });

  it('never reserves a negative inset when a non-16:9 landscape arena crops the fence off-screen', () => {
    // A square arena crops the image's sides — including the fence's left
    // and right lines — so those insets fall back to the arena edge itself.
    const insets = getFenceInsets({ width: 2000, height: 2000 });
    expect(insets.left).toBe(0);
    expect(insets.right).toBe(0);
    expect(insets.top).toBeGreaterThan(0);
    expect(insets.bottom).toBeGreaterThan(0);
  });
});
