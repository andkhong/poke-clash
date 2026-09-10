import { describe, expect, it } from 'vitest';
import { ANIM_TARGET_X, ANIM_TARGET_Y, ANIM_USER_X, ANIM_USER_Y } from '../../../data/moveAnimationFormat';
import { animationScaleFor, buildAnimTransform, mapBattlerOffset, mapCellAngle, mapCellDepth, mapCellPosition } from './geometry';

const near = (v: number, expected: number): void => expect(v).toBeCloseTo(expected, 6);
const AXIS_LENGTH = Math.hypot(ANIM_TARGET_X - ANIM_USER_X, ANIM_TARGET_Y - ANIM_USER_Y);
const UNIT_X = (ANIM_TARGET_X - ANIM_USER_X) / AXIS_LENGTH;
const UNIT_Y = (ANIM_TARGET_Y - ANIM_USER_Y) / AXIS_LENGTH;

describe('buildAnimTransform / mapCellPosition', () => {
  it('anchors focus-2 (user) cells on the attacker and focus-1 (target) cells on the target', () => {
    // The pack's numbering: self-buffs are focus 2 at the user spot, impacts are focus 1 at the target spot.
    const t = buildAnimTransform({ x: 100, y: 500 }, { x: 400, y: 200 }, 1);
    const u = mapCellPosition(t, ANIM_USER_X, ANIM_USER_Y, 2);
    near(u.x, 100);
    near(u.y, 500);
    const g = mapCellPosition(t, ANIM_TARGET_X, ANIM_TARGET_Y, 1);
    near(g.x, 400);
    near(g.y, 200);
  });

  it('stretches only the corridor of a both-focused cell: the canonical midpoint lands on the arena midpoint', () => {
    const attacker = { x: 50, y: 50 };
    const target = { x: 650, y: 50 }; // far apart, horizontal
    const t = buildAnimTransform(attacker, target, 0.5);
    const mid = mapCellPosition(t, (ANIM_USER_X + ANIM_TARGET_X) / 2, (ANIM_USER_Y + ANIM_TARGET_Y) / 2, 3);
    near(mid.x, 350);
    near(mid.y, 50);
    // the canonical target spot lands exactly on the target, however far it is
    const end = mapCellPosition(t, ANIM_TARGET_X, ANIM_TARGET_Y, 3);
    near(end.x, 650);
    near(end.y, 50);
    // a screen-focused cell uses the same mapping
    const screenEnd = mapCellPosition(t, ANIM_TARGET_X, ANIM_TARGET_Y, 4);
    near(screenEnd.x, 650);
    near(screenEnd.y, 50);
  });

  it('keeps a splat drawn around the target in proportion whether the fighters are far apart or adjacent', () => {
    // A cell 40 canonical px past the target along the axis (part of an impact drawn on it).
    const x = ANIM_TARGET_X + UNIT_X * 40;
    const y = ANIM_TARGET_Y + UNIT_Y * 40;
    const far = buildAnimTransform({ x: 0, y: 0 }, { x: 600, y: 0 }, 1);
    const farP = mapCellPosition(far, x, y, 3);
    near(farP.x, 640);
    near(farP.y, 0);
    const close = buildAnimTransform({ x: 0, y: 0 }, { x: 60, y: 0 }, 1);
    const closeP = mapCellPosition(close, x, y, 3);
    near(closeP.x, 100); // still 40px past the target — not squashed to 4px
    near(closeP.y, 0);
    // a cell 40px in front of the user stays 40px in front of the attacker when there's room;
    // with only 60px to the target the two zones shrink to meet at the midpoint instead
    const ux = ANIM_USER_X + UNIT_X * 40;
    const uy = ANIM_USER_Y + UNIT_Y * 40;
    near(mapCellPosition(far, ux, uy, 3).x, 40);
    near(mapCellPosition(close, ux, uy, 3).x, 30);
  });

  it('scales across-axis offsets with sprite size, not distance', () => {
    const t = buildAnimTransform({ x: 0, y: 0 }, { x: 1000, y: 0 }, 2);
    // 10px "above" the canonical user spot (perpendicular to the axis) -> 20px across in the arena.
    // Canonical axis is (256, -128); its perpendicular (same handedness) is (0.447, 0.894).
    const perpX = 128 / Math.hypot(256, 128);
    const perpY = 256 / Math.hypot(256, 128);
    const p = mapCellPosition(t, ANIM_USER_X + perpX * 10, ANIM_USER_Y + perpY * 10, 3);
    near(p.x, 0);
    near(p.y, 20); // arena perpendicular of (1,0) is (0,1)
  });

  it('rotates by 180° when the target is behind the attacker along the canonical direction', () => {
    const forward = buildAnimTransform({ x: 0, y: 0 }, { x: 256, y: -128 }, 1); // same direction as canonical
    near(forward.rotation, 0);
    const backward = buildAnimTransform({ x: 0, y: 0 }, { x: -256, y: 128 }, 1);
    near(Math.abs(backward.rotation), Math.PI);
    // a user-focused cell 50px "ahead" of the user flips to 50px behind
    const ahead = mapCellPosition(backward, ANIM_USER_X + 256 / 2.86, ANIM_USER_Y - 128 / 2.86, 2);
    expect(ahead.x).toBeLessThan(0);
    expect(ahead.y).toBeGreaterThan(0);
  });

  it('keeps the authored orientation and just scales when attacker and target coincide (self-targeting move)', () => {
    const t = buildAnimTransform({ x: 300, y: 300 }, { x: 300, y: 300 }, 0.5);
    expect(t.degenerate).toBe(true);
    near(t.rotation, 0);
    const p = mapCellPosition(t, ANIM_USER_X + 40, ANIM_USER_Y, 3);
    near(p.x, 320);
    near(p.y, 300);
    const q = mapCellPosition(t, ANIM_TARGET_X, ANIM_TARGET_Y, 1);
    near(q.x, 300);
    near(q.y, 300);
    // a status effect's user-focused cell right on the user spot sits on the Pokémon itself
    const s = mapCellPosition(t, ANIM_USER_X, ANIM_USER_Y, 2);
    near(s.x, 300);
    near(s.y, 300);
    // a screen-focused cell at the screen center sits on the Pokémon itself
    const c = mapCellPosition(t, 256, 192, 4);
    near(c.x, 300);
    near(c.y, 300);
  });
});

describe('mapBattlerOffset', () => {
  it('turns a dash covering the canonical user->target gap into a dash covering the real gap', () => {
    const t = buildAnimTransform({ x: 0, y: 0 }, { x: 60, y: 80 }, 1); // 100px apart, not axis-aligned
    const full = mapBattlerOffset(t, ANIM_TARGET_X - ANIM_USER_X, ANIM_TARGET_Y - ANIM_USER_Y);
    near(full.x, 60);
    near(full.y, 80);
    const half = mapBattlerOffset(t, (ANIM_TARGET_X - ANIM_USER_X) / 2, (ANIM_TARGET_Y - ANIM_USER_Y) / 2);
    near(half.x, 30);
    near(half.y, 40);
  });

  it('is a zero offset for a zero displacement', () => {
    const t = buildAnimTransform({ x: 10, y: 10 }, { x: 90, y: 10 }, 1.5);
    const o = mapBattlerOffset(t, 0, 0);
    near(o.x, 0);
    near(o.y, 0);
  });
});

describe('animationScaleFor', () => {
  it('scales with sprite size within bounds', () => {
    near(animationScaleFor(128), 1);
    near(animationScaleFor(64), 0.5);
    expect(animationScaleFor(10)).toBe(0.5);
    expect(animationScaleFor(800)).toBe(1.4);
  });
});

describe('mapCellAngle / mapCellDepth', () => {
  it('negates RGSS counter-clockwise angles and adds the frame rotation', () => {
    const t = buildAnimTransform({ x: 0, y: 0 }, { x: -256, y: 128 }, 1);
    near(Math.abs(mapCellAngle(t, 0)), 180);
    const forward = buildAnimTransform({ x: 0, y: 0 }, { x: 256, y: -128 }, 1);
    near(mapCellAngle(forward, 45), -45);
  });

  it('orders cells around the battlers by priority, with focus 1 = target and 2 = attacker', () => {
    const t = buildAnimTransform({ x: 0, y: 100 }, { x: 0, y: 300 }, 1);
    expect(mapCellDepth(t, 0, 3, 0)).toBeLessThan(100);
    expect(mapCellDepth(t, 1, 3, 0)).toBeGreaterThan(300);
    expect(mapCellDepth(t, 2, 2, 0)).toBeLessThan(100);
    expect(mapCellDepth(t, 3, 2, 0)).toBeGreaterThan(100);
    expect(mapCellDepth(t, 3, 2, 0)).toBeLessThan(300);
    expect(mapCellDepth(t, 3, 1, 0)).toBeGreaterThan(300);
    // later cells in the same frame draw above earlier ones
    expect(mapCellDepth(t, 1, 3, 5)).toBeGreaterThan(mapCellDepth(t, 1, 3, 4));
  });
});
