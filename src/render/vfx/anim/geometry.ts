import type { Vec2 } from '../../../sim/types';
import {
  ANIM_SCREEN_HEIGHT,
  ANIM_SCREEN_WIDTH,
  ANIM_TARGET_X,
  ANIM_TARGET_Y,
  ANIM_USER_X,
  ANIM_USER_Y,
} from '../../../data/moveAnimationFormat';

// Maps a converted Essentials animation (see src/data/moveAnimationFormat.ts)
// from the fixed side-view battle screen it was drawn for — user at
// bottom-left, target at top-right, always the same two spots — onto the
// arena, where the attacker and target can be anywhere and any distance
// apart. Pure functions; the player (AnimPlayer.ts) rebuilds a transform
// every frame from the battlers' live positions so a projectile keeps
// tracking a target that wanders mid-animation.
//
// The mapping, per cell focus:
//   user (1)   — the cell's offset from the canonical user spot, rotated
//                onto the arena's attacker->target direction and scaled,
//                anchored on the attacker.
//   target (2) — same, offset from the canonical target spot, on the target.
//   both (3) / screen (4) — the offset from the user spot is split into a
//                component along the user->target line and one across it.
//                Along is stretched to the arena's real attacker->target
//                distance (so a beam always reaches the target, whether
//                it's adjacent or across the arena), across is only scaled
//                with sprite size. Essentials itself does a similar
//                two-axis stretch for this focus; the arena additionally
//                rotates, since its attacks point in every direction.
// Cell zoom scales with sprite size only, never with distance, so a Tackle
// impact star is the same size whether the attacker had to dash 30px or
// 300px.

const CANONICAL_AXIS_X = ANIM_TARGET_X - ANIM_USER_X;
const CANONICAL_AXIS_Y = ANIM_TARGET_Y - ANIM_USER_Y;
const CANONICAL_AXIS_LENGTH = Math.hypot(CANONICAL_AXIS_X, CANONICAL_AXIS_Y);
const CANONICAL_UNIT_X = CANONICAL_AXIS_X / CANONICAL_AXIS_LENGTH;
const CANONICAL_UNIT_Y = CANONICAL_AXIS_Y / CANONICAL_AXIS_LENGTH;
/** Perpendicular to the canonical axis, same handedness as the arena's. */
const CANONICAL_PERP_X = -CANONICAL_UNIT_Y;
const CANONICAL_PERP_Y = CANONICAL_UNIT_X;
/** Below this attacker->target distance (px) the two are treated as the
 * same point — a self-targeting move — and the animation keeps its
 * authored orientation instead of picking a direction from noise. */
const DEGENERATE_DISTANCE_PX = 1;

export interface AnimTransform {
  attacker: Vec2;
  target: Vec2;
  /** Sprite-size scale applied to every cell and to across-axis offsets. */
  scale: number;
  /** Rotation from the canonical user->target direction to the arena's
   * attacker->target direction. Radians, Phaser's convention (clockwise
   * positive on screen, since y points down). Zero when degenerate. */
  rotation: number;
  /** True when attacker and target coincide (a self-targeting move): every
   * cell is then simply rotated by zero and scaled around the attacker. */
  degenerate: boolean;
  /** Unit arena direction attacker->target and its perpendicular (the
   * canonical axis/perpendicular when degenerate). */
  dirX: number;
  dirY: number;
  perpX: number;
  perpY: number;
  distance: number;
}

export function buildAnimTransform(attacker: Vec2, target: Vec2, scale: number): AnimTransform {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  const distance = Math.hypot(dx, dy);
  if (distance < DEGENERATE_DISTANCE_PX) {
    return {
      attacker,
      target,
      scale,
      rotation: 0,
      degenerate: true,
      dirX: CANONICAL_UNIT_X,
      dirY: CANONICAL_UNIT_Y,
      perpX: CANONICAL_PERP_X,
      perpY: CANONICAL_PERP_Y,
      distance: 0,
    };
  }
  const dirX = dx / distance;
  const dirY = dy / distance;
  return {
    attacker,
    target,
    scale,
    rotation: Math.atan2(dirY, dirX) - Math.atan2(CANONICAL_UNIT_Y, CANONICAL_UNIT_X),
    degenerate: false,
    dirX,
    dirY,
    perpX: -dirY,
    perpY: dirX,
    distance,
  };
}

/** A canonical-space offset expressed in the transform's rotated, scaled
 * frame: components along the canonical axis and across it become the
 * same components along/across the arena direction. */
function rotateOffset(t: AnimTransform, offsetX: number, offsetY: number): Vec2 {
  const along = (offsetX * CANONICAL_UNIT_X + offsetY * CANONICAL_UNIT_Y) * t.scale;
  const across = (offsetX * CANONICAL_PERP_X + offsetY * CANONICAL_PERP_Y) * t.scale;
  return { x: t.dirX * along + t.perpX * across, y: t.dirY * along + t.perpY * across };
}

/** Where a cell drawn at canonical (x, y) with the given focus lands in the arena. */
export function mapCellPosition(t: AnimTransform, x: number, y: number, focus: number): Vec2 {
  if (focus === 1) {
    const o = rotateOffset(t, x - ANIM_USER_X, y - ANIM_USER_Y);
    return { x: t.attacker.x + o.x, y: t.attacker.y + o.y };
  }
  if (focus === 2) {
    const o = rotateOffset(t, x - ANIM_TARGET_X, y - ANIM_TARGET_Y);
    return { x: t.target.x + o.x, y: t.target.y + o.y };
  }
  if (focus === 4 && t.degenerate) {
    // A screen-wide effect on a single Pokémon (a status animation, a
    // self-targeting move): center the screen on it rather than on the
    // user spot, which sits bottom-left of the screen it was drawn for.
    const o = rotateOffset(t, x - ANIM_SCREEN_WIDTH / 2, y - ANIM_SCREEN_HEIGHT / 2);
    return { x: t.attacker.x + o.x, y: t.attacker.y + o.y };
  }
  return mapStretched(t, x - ANIM_USER_X, y - ANIM_USER_Y, t.attacker);
}

/** Focus 3/4 and battler dashes: along-axis fraction of the canonical
 * user->target span becomes the same fraction of the arena's span; across
 * scales with sprite size. Degenerate transforms fall back to a plain
 * scaled offset so a self-targeting move still animates. */
function mapStretched(t: AnimTransform, offsetX: number, offsetY: number, origin: Vec2): Vec2 {
  if (t.degenerate) {
    const o = rotateOffset(t, offsetX, offsetY);
    return { x: origin.x + o.x, y: origin.y + o.y };
  }
  const alongFraction = (offsetX * CANONICAL_UNIT_X + offsetY * CANONICAL_UNIT_Y) / CANONICAL_AXIS_LENGTH;
  const across = (offsetX * CANONICAL_PERP_X + offsetY * CANONICAL_PERP_Y) * t.scale;
  const along = alongFraction * t.distance;
  return { x: origin.x + t.dirX * along + t.perpX * across, y: origin.y + t.dirY * along + t.perpY * across };
}

/** The arena offset to apply to a battler sprite for a canonical (dx, dy)
 * displacement from where it started — a Tackle dash covers the same
 * fraction of the real attacker->target gap it covered on the 512x384
 * screen. */
export function mapBattlerOffset(t: AnimTransform, dx: number, dy: number): Vec2 {
  const p = mapStretched(t, dx, dy, { x: 0, y: 0 });
  return { x: p.x, y: p.y };
}

/** Phaser angle (degrees) for a cell: the frame rotation plus the cell's
 * own — negated, since RGSS angles are counter-clockwise and Phaser's are
 * clockwise on screen. */
export function mapCellAngle(t: AnimTransform, cellAngleDegrees: number): number {
  return (t.rotation * 180) / Math.PI - cellAngleDegrees;
}

/** Depth for a cell given its priority (0 behind both battlers, 1 in front
 * of everything, 2 behind its focus battler, 3 in front of it) — the arena
 * sorts sprites by their y, so "behind"/"in front" become y ± a hair, and
 * later cells in a frame draw over earlier ones like they do in the pack. */
export function mapCellDepth(t: AnimTransform, priority: number, focus: number, cellIndex: number): number {
  const attackerY = t.attacker.y;
  const targetY = t.target.y;
  const focusY = focus === 1 ? attackerY : focus === 2 ? targetY : Math.max(attackerY, targetY);
  let base: number;
  switch (priority) {
    case 0:
      base = Math.min(attackerY, targetY) - 1;
      break;
    case 2:
      base = focusY - 0.5;
      break;
    case 3:
      base = focusY + 0.5;
      break;
    default:
      base = Math.max(attackerY, targetY) + 1;
  }
  return base + cellIndex * 0.001;
}
