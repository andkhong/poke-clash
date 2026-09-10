import { describe, expect, it } from 'vitest';
import { getPmdBodySize } from './pmdBodySizes';
import { buildSpeciesDataForLevel, hasPmdSprite, listAllSpecies } from './loader';
import {
  COLLISION_RADIUS_FACTOR,
  computeOnScreenSizeFromBody,
  PMD_MAX_BODY_SIZE,
  PMD_MIN_BODY_SIZE,
  PMD_SPRITE_SCALE,
} from '../sim/constants';

describe('measured PMD body sizes (src/data/generated/pmdBodySizes.json)', () => {
  it('covers every species with a PMD sprite — the sim sizes its hitbox from this before any sheet loads', () => {
    const missing = listAllSpecies()
      .filter((s) => hasPmdSprite(s.id) && getPmdBodySize(s.id) === undefined)
      .map((s) => s.id);
    expect(missing).toEqual([]);
  });

  it('is undefined for a species without a PMD sprite, so the loader falls back to its height estimate', () => {
    const withoutSprite = listAllSpecies().find((s) => !hasPmdSprite(s.id));
    expect(withoutSprite).toBeDefined();
    expect(getPmdBodySize(withoutSprite!.id)).toBeUndefined();
  });

  it('measures a visible body, never the padded frame canvas: no PMD body is under 16px or over 128px', () => {
    for (const s of listAllSpecies()) {
      const body = getPmdBodySize(s.id);
      if (body === undefined) continue;
      expect(body, `${s.name} (#${s.id})`).toBeGreaterThanOrEqual(16);
      expect(body, `${s.name} (#${s.id})`).toBeLessThanOrEqual(128);
    }
  });

  it('puts a fully evolved starter in the reference footage band (~95-125px of a 900px arena)', () => {
    const blaziken = 257;
    const torterra = 389;
    const greninja = 658;
    for (const id of [blaziken, torterra, greninja]) {
      const onScreen = computeOnScreenSizeFromBody(getPmdBodySize(id)!);
      expect(onScreen, `#${id}`).toBeGreaterThanOrEqual(90);
      expect(onScreen, `#${id}`).toBeLessThanOrEqual(130);
    }
  });

  it('gives the sim a collision radius derived from the same on-screen size the renderer draws', () => {
    for (const id of [25, 257, 321, 595]) {
      const data = buildSpeciesDataForLevel(id, 50)!;
      expect(data.collisionRadius).toBeCloseTo(computeOnScreenSizeFromBody(getPmdBodySize(id)!) * COLLISION_RADIUS_FACTOR);
    }
  });
});

describe('computeOnScreenSizeFromBody', () => {
  it('magnifies every body by the one shared PMD_SPRITE_SCALE inside the clamp band', () => {
    const lo = Math.ceil(PMD_MIN_BODY_SIZE / PMD_SPRITE_SCALE);
    const hi = Math.floor(PMD_MAX_BODY_SIZE / PMD_SPRITE_SCALE);
    for (let body = lo; body <= hi; body++) expect(computeOnScreenSizeFromBody(body)).toBe(body * PMD_SPRITE_SCALE);
  });

  it('clamps only the extremes: a speck is lifted to the floor, a giant capped', () => {
    expect(computeOnScreenSizeFromBody(1)).toBe(PMD_MIN_BODY_SIZE);
    expect(computeOnScreenSizeFromBody(10)).toBe(PMD_MIN_BODY_SIZE);
    expect(computeOnScreenSizeFromBody(100)).toBe(PMD_MAX_BODY_SIZE);
    expect(computeOnScreenSizeFromBody(1000)).toBe(PMD_MAX_BODY_SIZE);
  });

  it('never shrinks with a bigger body', () => {
    let previous = 0;
    for (let body = 1; body <= 200; body++) {
      const size = computeOnScreenSizeFromBody(body);
      expect(size).toBeGreaterThanOrEqual(previous);
      previous = size;
    }
  });
});
