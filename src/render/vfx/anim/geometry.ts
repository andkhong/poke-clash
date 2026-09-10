import type { Vec2 } from '../../../sim/types';
import {
  ANIM_REFERENCE_BATTLER_SIZE,
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
// The mapping, per cell focus (the numbering is the pack's own — measured
// from its data, not assumed: every self-buff's cells carry focus 2 and sit
// on the user spot, every Scratch/Bite/Thunderbolt impact carries focus 1
// and sits on the target spot):
//   target (1) — the cell's offset from the canonical target spot, rotated
//                onto the arena's attacker->target direction and scaled,
//                anchored on the target.
//   user (2)   — same, offset from the canonical user spot, on the attacker.
//   both (3) / screen (4) — split into a component along the user->target
//                line and one across it. Across only scales with sprite
//                size. Along is mapped in zones: within reach of the user
//                spot it stays a scaled offset from the attacker, within
//                reach of the target spot a scaled offset from the target,
//                and only the corridor between the two is stretched to the
//                arena's real gap. So a beam always reaches its target
//                whether it's adjacent or across the arena, while the
//                splat drawn at the target and the charge drawn at the user
//                keep their proportions instead of being squashed when the
//                fighters stand close (Essentials' own player stretches the
//                whole line, but its battlers never stand close).
// Cell zoom scales with sprite size only, never with distance.

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
/** How far (canonical px, along the axis) from each battler spot a
 * both/screen-focused cell still counts as "drawn on that battler" and
 * keeps its scaled offset rather than being stretched with the corridor:
 * half a cell, so a 192px impact centered on the target holds together. */
const BATTLER_ZONE_PX = 96;
/** Bounds on the sprite-size scale: the smallest arena Pokémon still get
 * readable effects, and a Boss Mode boss (3x sprite) doesn't get
 * screen-swallowing ones. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.4;

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

/** The scale an animation plays at for an attacker of the given on-screen
 * size (px, longest side), relative to the battlers the pack was drawn
 * around. */
export function animationScaleFor(onScreenSize: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, onScreenSize / ANIM_REFERENCE_BATTLER_SIZE));
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
    const o = rotateOffset(t, x - ANIM_TARGET_X, y - ANIM_TARGET_Y);
    return { x: t.target.x + o.x, y: t.target.y + o.y };
  }
  if (focus === 2) {
    const o = rotateOffset(t, x - ANIM_USER_X, y - ANIM_USER_Y);
    return { x: t.attacker.x + o.x, y: t.attacker.y + o.y };
  }
  if (t.degenerate) {
    // A whole-screen or between-the-battlers effect on a single Pokémon (a
    // status animation, a self-targeting move): screen cells center the
    // screen on it rather than the user spot, which sits bottom-left of
    // the screen they were drawn for; line cells keep their offset from
    // the user spot.
    const o =
      focus === 4
        ? rotateOffset(t, x - ANIM_SCREEN_WIDTH / 2, y - ANIM_SCREEN_HEIGHT / 2)
        : rotateOffset(t, x - ANIM_USER_X, y - ANIM_USER_Y);
    return { x: t.attacker.x + o.x, y: t.attacker.y + o.y };
  }
  return mapAlongLine(t, x - ANIM_USER_X, y - ANIM_USER_Y);
}

/** Focus 3/4: the zone mapping described in the file comment, for an offset
 * from the canonical user spot. */
function mapAlongLine(t: AnimTransform, offsetX: number, offsetY: number): Vec2 {
  const along = offsetX * CANONICAL_UNIT_X + offsetY * CANONICAL_UNIT_Y;
  const across = (offsetX * CANONICAL_PERP_X + offsetY * CANONICAL_PERP_Y) * t.scale;
  // Shrink both zones when the fighters are so close that the zones would
  // overlap, so the corridor collapses to a point instead of running
  // backwards.
  const zone = Math.min(BATTLER_ZONE_PX, t.distance / (2 * t.scale));
  let alongArena: number;
  if (along <= zone) {
    alongArena = along * t.scale; // on the attacker: scaled, not stretched
  } else if (along >= CANONICAL_AXIS_LENGTH - zone) {
    alongArena = t.distance + (along - CANONICAL_AXIS_LENGTH) * t.scale; // on the target
  } else {
    const corridorFraction = (along - zone) / (CANONICAL_AXIS_LENGTH - 2 * zone);
    const corridorStart = zone * t.scale;
    const corridorEnd = t.distance - zone * t.scale;
    alongArena = corridorStart + corridorFraction * (corridorEnd - corridorStart);
  }
  return {
    x: t.attacker.x + t.dirX * alongArena + t.perpX * across,
    y: t.attacker.y + t.dirY * alongArena + t.perpY * across,
  };
}

/** The arena offset to apply to a battler sprite for a canonical (dx, dy)
 * displacement from where it started — a Tackle dash covers the same
 * fraction of the real attacker->target gap it covered on the 512x384
 * screen; a recoil or hop scales with sprite size. */
export function mapBattlerOffset(t: AnimTransform, dx: number, dy: number): Vec2 {
  if (t.degenerate) return rotateOffset(t, dx, dy);
  const alongFraction = (dx * CANONICAL_UNIT_X + dy * CANONICAL_UNIT_Y) / CANONICAL_AXIS_LENGTH;
  const across = (dx * CANONICAL_PERP_X + dy * CANONICAL_PERP_Y) * t.scale;
  const along = alongFraction * t.distance;
  return { x: t.dirX * along + t.perpX * across, y: t.dirY * along + t.perpY * across };
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
  const focusY = focus === 1 ? targetY : focus === 2 ? attackerY : Math.max(attackerY, targetY);
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
