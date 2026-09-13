import { describe, expect, it } from 'vitest';
import { COLLISION_RADIUS_FACTOR, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH, getFenceInsets } from '../../sim/constants';
import { blockingRowIds, fighterScreenBox, nextHiddenRows, sideRosterFits } from './rosterOcclusion';

/** A fighter whose visible body's longest side is 100 sim px, feet at (x, y). */
function fighter(x: number, y: number) {
  return { position: { x, y }, collisionRadius: 100 * COLLISION_RADIUS_FACTOR };
}

describe('sideRosterFits', () => {
  const arena = { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };
  const footprint = 158;

  it('fits beside the fence on a desktop-sized stage', () => {
    expect(sideRosterFits(arena, 1012, footprint)).toBe(true);
  });

  it('does not fit on a phone-width stage', () => {
    expect(sideRosterFits(arena, 390, footprint)).toBe(false);
  });

  it('switches exactly where the nearer fence line reaches the footprint', () => {
    const fence = getFenceInsets(arena);
    const threshold = (footprint * arena.width) / Math.min(fence.left, fence.right);
    expect(sideRosterFits(arena, threshold + 1, footprint)).toBe(true);
    expect(sideRosterFits(arena, threshold - 1, footprint)).toBe(false);
  });
});

describe('fighterScreenBox', () => {
  it('maps the body (standing above the feet) from sim px to stage px, then pads it', () => {
    const box = fighterScreenBox(fighter(400, 600), 0.5, 8);
    expect(box.left).toBeCloseTo(350 * 0.5 - 8);
    expect(box.right).toBeCloseTo(450 * 0.5 + 8);
    expect(box.top).toBeCloseTo(500 * 0.5 - 8);
    // Reaches a little below the feet, where the in-world HP bar hangs.
    expect(box.bottom).toBeGreaterThan(600 * 0.5 + 8);
  });
});

describe('blockingRowIds', () => {
  const row = { id: 'a', rect: { left: 0, top: 200, right: 150, bottom: 220 } };
  const farRow = { id: 'b', rect: { left: 0, top: 400, right: 150, bottom: 420 } };

  it('flags only the rows a fighter box overlaps', () => {
    const box = { left: 140, top: 150, right: 240, bottom: 260 };
    expect(blockingRowIds([row, farRow], [box])).toEqual(new Set(['a']));
  });

  it('does not count a box that only touches a row edge', () => {
    const box = { left: 150, top: 150, right: 250, bottom: 260 };
    expect(blockingRowIds([row], [box]).size).toBe(0);
  });

  it('flags nothing with no fighters on the map', () => {
    expect(blockingRowIds([row, farRow], []).size).toBe(0);
  });
});

describe('nextHiddenRows', () => {
  it('keeps a row hidden for the hold after it stops blocking, then shows it again', () => {
    let hidden = nextHiddenRows(new Map(), new Set(['a']), 0, 500);
    expect([...hidden.keys()]).toEqual(['a']);

    hidden = nextHiddenRows(hidden, new Set(), 300, 500);
    expect(hidden.has('a')).toBe(true);

    hidden = nextHiddenRows(hidden, new Set(), 500, 500);
    expect(hidden.has('a')).toBe(false);
  });

  it('extends the hold while the row keeps blocking', () => {
    let hidden = nextHiddenRows(new Map(), new Set(['a']), 0, 500);
    hidden = nextHiddenRows(hidden, new Set(['a']), 400, 500);
    hidden = nextHiddenRows(hidden, new Set(), 800, 500);
    expect(hidden.has('a')).toBe(true);
  });
});
