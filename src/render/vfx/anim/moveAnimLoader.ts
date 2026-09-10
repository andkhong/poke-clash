import Phaser from 'phaser';
import type { MoveAnimationIndex, MoveAnimationIndexEntry } from '../../../data/types';
import moveAnimationIndexData from '../../../data/generated/moveAnimations.json';
import {
  ANIM_CELL_SIZE,
  animationSheetUrl,
  commonAnimationUrl,
  moveAnimationUrl,
  type MoveAnimationData,
} from '../../../data/moveAnimationFormat';

// Fetch-on-demand plumbing for the converted move animations
// (public/move-anims/, see data-pipeline/build-move-animations.ts). Same
// shape as the move sounds and cries: the bundle carries only the small
// index; each animation's JSON and its sheet are static files loaded
// through Phaser's loader the first time a match needs them and cached at
// the game level from then on (Phaser's texture and JSON caches outlive a
// scene restart, so a rematch pays nothing). ArenaScene queues every move
// its roster can use during preload(), so in practice an attack's data is
// already there when it fires; getLoaded*() returning null is the rare
// straggler case the caller covers with a fallback flash.

const INDEX = moveAnimationIndexData as MoveAnimationIndex;

/** Cache tag on every /move-anims/ URL — bump whenever the converter's
 * output changes shape or pixels, since Caddy serves these with a long
 * max-age (see Caddyfile). */
export const MOVE_ANIM_ASSET_VERSION = 1;

export interface LoadedAnimation {
  data: MoveAnimationData;
  /** Texture key of the animation's sheet, with its cell frames registered
   * (see ensureSheetFrames), or null for a battler-only animation. */
  sheetKey: string | null;
}

export function getMoveAnimationEntry(moveId: number): MoveAnimationIndexEntry | undefined {
  return INDEX.moves[String(moveId)];
}

export function getCommonAnimationEntry(name: string): MoveAnimationIndexEntry | undefined {
  return INDEX.common[name];
}

function tagged(url: string): string {
  return `${url}?v=${MOVE_ANIM_ASSET_VERSION}`;
}

function moveJsonKey(moveId: number): string {
  return `move-anim-${moveId}`;
}

function commonJsonKey(name: string): string {
  return `common-anim-${name}`;
}

function sheetTextureKey(slug: string): string {
  return `move-anim-sheet-${slug}`;
}

function queueOne(scene: Phaser.Scene, jsonKey: string, url: string, entry: MoveAnimationIndexEntry): number {
  let queued = 0;
  if (!scene.cache.json.exists(jsonKey)) {
    scene.load.json(jsonKey, tagged(url));
    queued += 1;
  }
  if (entry.sheet) {
    const key = sheetTextureKey(entry.sheet);
    if (!scene.textures.exists(key)) {
      scene.load.image(key, tagged(animationSheetUrl(entry.sheet)));
      queued += 1;
    }
  }
  return queued;
}

/** Adds every not-yet-cached JSON/sheet for the given moves and common
 * animations to the scene's loader (deduplicated by Phaser's own key
 * check). Call during preload(), or start the loader yourself afterward. */
export function queueAnimationLoads(scene: Phaser.Scene, moveIds: Iterable<number>, commonNames: Iterable<string> = []): number {
  let queued = 0;
  for (const moveId of moveIds) {
    const entry = getMoveAnimationEntry(moveId);
    if (entry) queued += queueOne(scene, moveJsonKey(moveId), moveAnimationUrl(moveId), entry);
  }
  for (const name of commonNames) {
    const entry = getCommonAnimationEntry(name);
    if (entry) queued += queueOne(scene, commonJsonKey(name), commonAnimationUrl(name), entry);
  }
  return queued;
}

/** For an attack whose animation wasn't preloaded (a move outside the
 * roster's known slots, or a failed fetch): queue it and kick the loader
 * so the *next* use of the move has it. Phaser accepts files added to a
 * loader that's already running, so this is safe mid-match. */
export function requestMoveAnimation(scene: Phaser.Scene, moveId: number): void {
  if (queueAnimationLoads(scene, [moveId]) > 0 && !scene.load.isLoading()) scene.load.start();
}

/** Registers one texture frame per 192x192 cell of a loaded sheet (named
 * by the cell's row-major index, the animation's `pattern`), so cells can
 * be drawn as ordinary Images with the cell's center as their origin. Idempotent. */
export function ensureSheetFrames(scene: Phaser.Scene, sheetKey: string): boolean {
  if (!scene.textures.exists(sheetKey)) return false;
  const texture = scene.textures.get(sheetKey);
  if (texture.has('0')) return true;
  const source = texture.getSourceImage() as { width: number; height: number };
  const columns = Math.max(1, Math.floor(source.width / ANIM_CELL_SIZE));
  const rows = Math.max(1, Math.ceil(source.height / ANIM_CELL_SIZE));
  for (let row = 0; row < rows; row++) {
    const y = row * ANIM_CELL_SIZE;
    const height = Math.min(ANIM_CELL_SIZE, source.height - y);
    for (let column = 0; column < columns; column++) {
      texture.add(String(row * columns + column), 0, column * ANIM_CELL_SIZE, y, ANIM_CELL_SIZE, height);
    }
  }
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return true;
}

function resolveLoaded(scene: Phaser.Scene, jsonKey: string, entry: MoveAnimationIndexEntry | undefined): LoadedAnimation | null {
  if (!entry || !scene.cache.json.exists(jsonKey)) return null;
  const data = scene.cache.json.get(jsonKey) as MoveAnimationData;
  if (!data.sheet) return { data, sheetKey: null };
  const sheetKey = sheetTextureKey(data.sheet);
  if (!ensureSheetFrames(scene, sheetKey)) return null;
  return { data, sheetKey };
}

export function getLoadedMoveAnimation(scene: Phaser.Scene, moveId: number): LoadedAnimation | null {
  return resolveLoaded(scene, moveJsonKey(moveId), getMoveAnimationEntry(moveId));
}

export function getLoadedCommonAnimation(scene: Phaser.Scene, name: string): LoadedAnimation | null {
  return resolveLoaded(scene, commonJsonKey(name), getCommonAnimationEntry(name));
}
