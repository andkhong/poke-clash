import Phaser from 'phaser';
import type { Vec2 } from '../../../sim/types';
import {
  ANIM_NATIVE_FPS,
  BattlerCell,
  Cell,
  type MoveAnimationBattlerCell,
  type MoveAnimationData,
} from '../../../data/moveAnimationFormat';
import { buildAnimTransform, mapBattlerOffset, mapCellAngle, mapCellDepth, mapCellPosition, type AnimTransform } from './geometry';

// Plays one converted Essentials animation (src/data/moveAnimationFormat.ts)
// in the arena: a pool of Images, one per cell slot, re-posed every render
// frame from the animation's current frame and the battlers' *live*
// positions (see geometry.ts), plus the animation's own instructions for
// the battler sprites themselves (dash, hide, fade) forwarded through
// AnimBattler hooks. Runs off the scene's update event so a scene
// shutdown/restart mid-animation tears it down cleanly.

/** How much faster than the pack's native 20 fps attacks play by default —
 * the arena is real-time and its attack window is short, and the pack's
 * animations were paced for a turn-based battle screen with nothing else
 * going on. */
export const ATTACK_PLAYBACK_SPEED = 2;

/** Ms per animation frame such that `frames` frames play at `speed` times
 * native rate but never exceed `maxDurationMs` in total — long animations
 * (Spectral Thief is 95 frames, 4.75 s at native rate) compress to fit
 * rather than overrunning the attacker's hold window. */
export function frameDurationMs(frames: number, maxDurationMs: number, speed = ATTACK_PLAYBACK_SPEED): number {
  const native = 1000 / ANIM_NATIVE_FPS / speed;
  return Math.min(native, maxDurationMs / Math.max(1, frames));
}

/** What the animation is allowed to do to a battler's sprite. Both
 * methods must tolerate being called on a sprite that has since been
 * destroyed (a target that fainted mid-animation). */
export interface AnimBattler {
  setAnimOffset(x: number, y: number): void;
  setAnimAlpha(alpha: number): void;
}

export interface PlayAnimationOptions {
  scene: Phaser.Scene;
  data: MoveAnimationData;
  sheetKey: string | null;
  /** Live anchors, read every render frame. For a self-targeting move
   * return the attacker's position from both. */
  getAttacker: () => Vec2;
  getTarget: () => Vec2;
  /** Sprite-size scale for the cells (see ANIM_REFERENCE_BATTLER_SIZE). */
  scale: number;
  msPerFrame: number;
  attacker?: AnimBattler;
  target?: AnimBattler;
  onComplete?: () => void;
}

export interface AnimationHandle {
  /** Total playback time, ms. */
  readonly durationMs: number;
  /** Ends the animation early: cells are removed and both battlers reset. */
  stop(): void;
}

/** Phaser's WebGL renderer supports only NORMAL/ADD/MULTIPLY/SCREEN/ERASE;
 * the pack's subtractive blend (dark smoke, shadows) is approximated by
 * MULTIPLY, which also darkens what's underneath. */
const BLEND_MODES = [Phaser.BlendModes.NORMAL, Phaser.BlendModes.ADD, Phaser.BlendModes.MULTIPLY] as const;
/** A cell color overlay this opaque or more replaces the cell's pixels
 * outright (a white flash, a black silhouette); anything fainter is
 * approximated as a tint toward that color. */
const TINT_FILL_ALPHA = 200;

function mixTowardColor(rgb: number, alpha: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const mix = (c: number): number => Math.round(255 * (1 - alpha) + c * alpha);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

function applyBattler(hooks: AnimBattler | undefined, cell: MoveAnimationBattlerCell | null, t: AnimTransform): void {
  if (!hooks) return;
  if (!cell) {
    hooks.setAnimOffset(0, 0);
    hooks.setAnimAlpha(1);
    return;
  }
  const offset = mapBattlerOffset(t, cell[BattlerCell.DX], cell[BattlerCell.DY]);
  hooks.setAnimOffset(offset.x, offset.y);
  hooks.setAnimAlpha(cell[BattlerCell.VISIBLE] ? cell[BattlerCell.OPACITY] / 255 : 0);
}

export function playAnimation(options: PlayAnimationOptions): AnimationHandle {
  const { scene, data, sheetKey, msPerFrame } = options;
  const frames = data.frames;
  const durationMs = frames.length * msPerFrame;
  const pool: Phaser.GameObjects.Image[] = [];
  const texture = sheetKey ? scene.textures.get(sheetKey) : null;
  const startedAt = scene.time.now;
  let lastFrame = -1;
  let finished = false;

  const imageAt = (index: number): Phaser.GameObjects.Image => {
    while (pool.length <= index) {
      const image = scene.add.image(0, 0, sheetKey ?? '__DEFAULT').setVisible(false);
      pool.push(image);
    }
    return pool[index];
  };

  const render = (frameIndex: number): void => {
    const t = buildAnimTransform(options.getAttacker(), options.getTarget(), options.scale);
    const frame = frames[frameIndex];
    const cells = texture ? frame.c : [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const image = imageAt(i);
      const frameName = String(cell[Cell.PATTERN]);
      if (!texture!.has(frameName)) {
        image.setVisible(false); // a pattern past the sheet's grid draws nothing, as in the pack's own editor
        continue;
      }
      const position = mapCellPosition(t, cell[Cell.X], cell[Cell.Y], cell[Cell.FOCUS]);
      image
        .setVisible(true)
        .setFrame(frameName)
        .setPosition(position.x, position.y)
        .setScale((cell[Cell.ZOOM_X] / 100) * t.scale, (cell[Cell.ZOOM_Y] / 100) * t.scale)
        .setAngle(mapCellAngle(t, cell[Cell.ANGLE]))
        .setFlipX(cell[Cell.MIRROR] === 1)
        .setAlpha(cell[Cell.OPACITY] / 255)
        .setBlendMode(BLEND_MODES[cell[Cell.BLEND]] ?? Phaser.BlendModes.NORMAL)
        .setDepth(mapCellDepth(t, cell[Cell.PRIORITY], cell[Cell.FOCUS], i));
      const color = cell[Cell.COLOR];
      const colorAlpha = color >>> 24;
      if (colorAlpha >= TINT_FILL_ALPHA) image.setTintFill(color & 0xffffff);
      else if (colorAlpha > 0) image.setTint(mixTowardColor(color & 0xffffff, colorAlpha / 255));
      else image.clearTint();
    }
    for (let i = cells.length; i < pool.length; i++) pool[i].setVisible(false);
    if (frameIndex !== lastFrame) {
      applyBattler(options.attacker, frame.u, t);
      applyBattler(options.target, frame.t, t);
      lastFrame = frameIndex;
    }
  };

  const teardown = (): void => {
    if (finished) return;
    finished = true;
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    for (const image of pool) image.destroy();
    pool.length = 0;
    options.attacker?.setAnimOffset(0, 0);
    options.attacker?.setAnimAlpha(1);
    options.target?.setAnimOffset(0, 0);
    options.target?.setAnimAlpha(1);
  };

  const onUpdate = (): void => {
    if (finished) return;
    if (!scene.sys.isActive()) {
      teardown();
      return;
    }
    const frameIndex = Math.floor((scene.time.now - startedAt) / msPerFrame);
    if (frameIndex >= frames.length) {
      teardown();
      options.onComplete?.();
      return;
    }
    render(frameIndex);
  };

  if (frames.length === 0) {
    finished = true;
    options.onComplete?.();
    return { durationMs: 0, stop: () => {} };
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
  render(0);

  return { durationMs, stop: teardown };
}
