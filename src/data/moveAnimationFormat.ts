// The on-disk format shared by data-pipeline/build-move-animations.ts (which
// writes it) and src/render/vfx/anim/ (which plays it): the compact JSON the
// Gen 9 Move Animation Project's Essentials animations are converted into.
// Kept as `as const` index tables rather than object keys so a 20-frame,
// 30-cell animation stays a few KB — every cell is a flat tuple.

/** The 512x384 Essentials battle screen every animation was authored
 * against, and where its two battlers stand on it: the user (attacker) at
 * bottom-left, the target at top-right. Cells are positioned in this
 * coordinate space; the player maps them onto the arena (see
 * src/render/vfx/anim/geometry.ts). */
export const ANIM_SCREEN_WIDTH = 512;
export const ANIM_SCREEN_HEIGHT = 384;
export const ANIM_USER_X = 128;
export const ANIM_USER_Y = 224;
export const ANIM_TARGET_X = 384;
export const ANIM_TARGET_Y = 96;
/** Sheets are grids of square cells this size; a cell's `pattern` indexes
 * them row-major with floor(sheetWidth / ANIM_CELL_SIZE) per row. */
export const ANIM_CELL_SIZE = 192;
/** Essentials plays animations at 20 fps. */
export const ANIM_NATIVE_FPS = 20;
/** How large the battler sprites the animations were drawn around are on
 * that 512x384 screen (px, longest side) — the reference the arena's own
 * per-species sprite size is compared against to scale an animation. */
export const ANIM_REFERENCE_BATTLER_SIZE = 128;

/** Indices into a MoveAnimationCell tuple. */
export const Cell = {
  X: 0,
  Y: 1,
  ZOOM_X: 2,
  ZOOM_Y: 3,
  /** Degrees, counter-clockwise like RGSS. */
  ANGLE: 4,
  /** 1 = flipped horizontally. */
  MIRROR: 5,
  /** 0 normal, 1 additive, 2 subtractive. */
  BLEND: 6,
  /** Row-major cell index into the sheet. */
  PATTERN: 7,
  /** 0..255 */
  OPACITY: 8,
  /** 0 behind both battlers, 1 in front of everything, 2 behind the focus
   * battler, 3 in front of the focus battler. */
  PRIORITY: 9,
  /** 1 anchored to the target, 2 to the user, 3 between them (the line
   * from user to target), 4 the whole screen. This is the pack's own
   * numbering, established from its data rather than assumed: every
   * self-buff's cells carry 2 and sit on the user spot, every impact
   * (Scratch, Bite, Thunderbolt) carries 1 and sits on the target spot. */
  FOCUS: 10,
  /** 0 = none, else 0xAARRGGBB — a flat color blended over the cell at that
   * alpha. */
  COLOR: 11,
} as const;

export type MoveAnimationCell = [
  x: number,
  y: number,
  zoomX: number,
  zoomY: number,
  angle: number,
  mirror: 0 | 1,
  blend: 0 | 1 | 2,
  pattern: number,
  opacity: number,
  priority: 0 | 1 | 2 | 3,
  focus: 1 | 2 | 3 | 4,
  color: number,
];

/** Indices into a MoveAnimationBattlerCell tuple: what the animation does
 * to the user/target *sprite itself* this frame (a Tackle dashes the user
 * forward, Fly hides it, Explosion hides it for good). Offsets are relative
 * to where that battler stood in frame 0, in the 512x384 screen space. */
export const BattlerCell = {
  DX: 0,
  DY: 1,
  /** 0..255 */
  OPACITY: 2,
  /** 0 = hidden this frame. */
  VISIBLE: 3,
} as const;

export type MoveAnimationBattlerCell = [dx: number, dy: number, opacity: number, visible: 0 | 1];

export interface MoveAnimationFrame {
  /** Null when the animation leaves that battler alone this frame. */
  u: MoveAnimationBattlerCell | null;
  t: MoveAnimationBattlerCell | null;
  c: MoveAnimationCell[];
}

/** A sound-effect cue from the pack's timing track: [frame, clip name,
 * volume 0..100, pitch percent]. Recorded for a later frame-synced audio
 * pass; the player ignores it today (the move's own clip plays instead —
 * see render/sound/moveSound.ts). */
export type MoveAnimationSfxCue = [frame: number, clip: string, volume: number, pitch: number];

/** One converted animation — public/move-anims/moves/<moveId>.json or
 * public/move-anims/common/<name>.json. */
export interface MoveAnimationData {
  v: 1;
  /** The pack's own name for it, e.g. "Move:TACKLE" or "Common:Poison". */
  name: string;
  /** Sheet slug under public/move-anims/sheets/ (any hue variant already
   * baked into the file the slug names), or null for an animation that
   * only moves/hides the battlers. */
  sheet: string | null;
  /** Cells per sheet row — floor(sheetWidth / ANIM_CELL_SIZE). */
  columns: number;
  /** The pack's own per-animation "position" field. Informational only:
   * it is not applied consistently by the pack's authors (Swords Dance
   * says 1, Harden 2, Agility 3, Calm Mind 4), so the player relies on
   * each cell's own focus instead. */
  position: 1 | 2 | 3 | 4;
  frames: MoveAnimationFrame[];
  sfx: MoveAnimationSfxCue[];
}

/** A battler cell that leaves the sprite as it stands: no displacement,
 * fully opaque, visible — the same as no cell at all. */
function isBattlerCellIdle(cell: MoveAnimationBattlerCell | null): boolean {
  return !cell || (cell[0] === 0 && cell[1] === 0 && cell[2] === 255 && cell[3] === 1);
}

/** How many of the frames are worth playing: all of them minus a trailing
 * run that draws nothing and leaves both battlers where they stand. The
 * pack pads some animations with such an idle tail for its own battle
 * screen (Explosion holds 50 empty frames after its 15 of smoke, waiting
 * for the user to faint) — in the arena that tail only compresses the
 * real frames into the attack window, so the player stops at the last
 * frame that does something. */
export function playableFrameCount(frames: readonly MoveAnimationFrame[]): number {
  let count = frames.length;
  while (count > 0) {
    const frame = frames[count - 1];
    if (frame.c.length > 0 || !isBattlerCellIdle(frame.u) || !isBattlerCellIdle(frame.t)) break;
    count -= 1;
  }
  return count;
}

/** The pack's status-condition animations the arena plays as ambient VFX
 * (see PokemonSprite.ts's updateStatusVfx), keyed by the sim's status.
 * Sleep keeps its text "Z"s instead. */
/** The pack's generic "health restored" animation, played one-shot on a
 * Pokémon healed by a shop item (see PokemonSprite's playHealVfx). Already
 * built and shipped as public/move-anims/common/HealthUp.json; it just had
 * no caller until the shop. */
export const HEAL_COMMON_ANIMATION = 'HealthUp';

export const STATUS_COMMON_ANIMATIONS = {
  poison: 'Poison',
  burn: 'Burn',
  paralysis: 'Paralysis',
  freeze: 'Frozen',
} as const;

export function moveAnimationUrl(moveId: number): string {
  return `/move-anims/moves/${moveId}.json`;
}

export function commonAnimationUrl(name: string): string {
  return `/move-anims/common/${name}.json`;
}

export function animationSheetUrl(slug: string): string {
  return `/move-anims/sheets/${slug}.png`;
}
