import { describe, expect, it } from 'vitest';
import { ANIM_TARGET_X, ANIM_TARGET_Y, ANIM_USER_X, ANIM_USER_Y } from '../../../data/moveAnimationFormat';
import {
  animationScaleFor,
  buildAnimTransform,
  isCellOffscreen,
  mapBattlerOffset,
  mapCellAngle,
  mapCellDepth,
  mapCellPosition,
} from './geometry';

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

describe('mapCellPosition with a ScreenAnchor', () => {
  it('pins screen-focused cells on the chosen battler, leaving other focuses alone', () => {
    // Attacker->target in exactly the canonical direction, so rotation is zero.
    const t = buildAnimTransform({ x: 0, y: 0 }, { x: ANIM_TARGET_X - ANIM_USER_X, y: ANIM_TARGET_Y - ANIM_USER_Y }, 1);
    const anchor = { on: 'target' as const, center: { x: 256, y: 129 } };
    // The animation's center lands on the target...
    const c = mapCellPosition(t, 256, 129, 4, anchor);
    near(c.x, t.target.x);
    near(c.y, t.target.y);
    // ...and an offset from it keeps its size.
    const o = mapCellPosition(t, 256 + 30, 129, 4, anchor);
    near(o.x, t.target.x + 30);
    near(o.y, t.target.y);
    // A user-focused cell still sits on the attacker, as without an anchor.
    const u = mapCellPosition(t, ANIM_USER_X, ANIM_USER_Y, 2, anchor);
    near(u.x, 0);
    near(u.y, 0);
    // Without the anchor the same screen cell spreads along the line instead.
    const spread = mapCellPosition(t, 256, 129, 4);
    expect(spread.x).toBeGreaterThan(0);
    expect(spread.x).toBeLessThan(t.target.x);
    // 'user' pins on the attacker.
    const onUser = mapCellPosition(t, 256, 129, 4, { on: 'user', center: { x: 256, y: 129 } });
    near(onUser.x, 0);
    near(onUser.y, 0);
  });
});

describe('upright transforms', () => {
  it('keep battler-anchored cells at their authored offset and unturned whatever the direction', () => {
    // Attacker->target runs exactly opposite to the canonical direction: a half turn.
    const attacker = { x: 256, y: 0 };
    const target = { x: 0, y: 128 };
    const turned = buildAnimTransform(attacker, target, 1);
    const upright = buildAnimTransform(attacker, target, 1, { upright: true });
    near(Math.abs(mapCellAngle(turned, 0)), 180);
    near(mapCellAngle(upright, 0), 0);
    near(mapCellAngle(upright, 45), -45); // the cell's own angle still applies
    // A cell 30px right of and 20px above the target spot (an eye of Scary Face)...
    const turnedEye = mapCellPosition(turned, ANIM_TARGET_X + 30, ANIM_TARGET_Y - 20, 1);
    near(turnedEye.x, target.x - 30); // ...is turned to the other side by the half turn...
    near(turnedEye.y, target.y + 20);
    const uprightEye = mapCellPosition(upright, ANIM_TARGET_X + 30, ANIM_TARGET_Y - 20, 1);
    near(uprightEye.x, target.x + 30); // ...but stays where it was drawn when upright.
    near(uprightEye.y, target.y - 20);
    // Same on the attacker, scaled with the sprite size.
    const half = buildAnimTransform(attacker, target, 0.5, { upright: true });
    const eyes = mapCellPosition(half, ANIM_USER_X + 8, ANIM_USER_Y - 70, 2);
    near(eyes.x, attacker.x + 4);
    near(eyes.y, attacker.y - 35);
    // A cell drawn along the line still runs attacker->target: the canonical target spot lands on the target.
    const end = mapCellPosition(upright, ANIM_TARGET_X, ANIM_TARGET_Y, 3);
    near(end.x, target.x);
    near(end.y, target.y);
    // A screen-wide cell pinned on a battler keeps its authored offset too.
    const pinned = mapCellPosition(upright, 256 + 30, 129, 4, { on: 'target', center: { x: 256, y: 129 } });
    near(pinned.x, target.x + 30);
    near(pinned.y, target.y);
    // Off by default.
    expect(buildAnimTransform(attacker, target, 1).upright).toBe(false);
  });
});

describe('isCellOffscreen', () => {
  it('flags only cells wholly outside the 512x384 screen at their zoom', () => {
    expect(isCellOffscreen(-128, 352, 100, 100)).toBe(true); // Lumina Crash's parked flash
    expect(isCellOffscreen(-60, 200, 100, 100)).toBe(false); // pokes in from the left edge
    expect(isCellOffscreen(-60, 200, 50, 50)).toBe(true); // ...but not at half size
    expect(isCellOffscreen(600, 200, 100, 100)).toBe(false); // still 8px inside the right edge
    expect(isCellOffscreen(620, 200, 100, 100)).toBe(true);
    expect(isCellOffscreen(256, 480, 100, 100)).toBe(true);
    expect(isCellOffscreen(256, 192, 100, 100)).toBe(false);
    expect(isCellOffscreen(128, 282, 100, 100)).toBe(false); // Dig's second mound is on screen
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

  it('ranks cells against the battlers’ own depth when the anchors are lifted to their body centers', () => {
    // Anchors 30px above the sprites' ground positions (100 and 200).
    const t = buildAnimTransform({ x: 0, y: 70 }, { x: 300, y: 170 }, 1, { attackerY: 100, targetY: 200 });
    near(mapCellDepth(t, 3, 1, 0), 200.5); // in front of the target: just above the target sprite's depth
    near(mapCellDepth(t, 2, 2, 0), 99.5); // behind the attacker
    near(mapCellDepth(t, 0, 3, 0), 99); // behind both
    near(mapCellDepth(t, 1, 3, 0), 201); // in front of everything
    // Without depths the anchors' own y is used, as before.
    const plain = buildAnimTransform({ x: 0, y: 70 }, { x: 300, y: 170 }, 1);
    near(mapCellDepth(plain, 3, 1, 0), 170.5);
  });
});
