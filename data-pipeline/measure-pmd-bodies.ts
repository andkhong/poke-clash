import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { mapWithConcurrency } from './pokeapi';
import { PMD_SPRITE_INDEX_PATH } from './pmdSpriteIndexFiles';
import type { PmdAnimEntry, PmdSpriteIndex } from '../src/data/types';

// Measures how big each species' PMD sprite actually *is* — the bounding
// box of its visible (non-transparent) pixels across every frame and
// direction of its Idle sheet — and writes the result to
// src/data/generated/pmdBodySizes.json as { "<species id>": [width, height] }
// in native sheet pixels.
//
// The sheet's frame canvas (frameWidth/frameHeight in the index) is no use
// for this: PMDCollab pads each frame for the animation's full range of
// motion, and how much varies wildly per species (the visible body fills
// anywhere from ~40% to ~98% of the canvas's longest side). Scaling the
// canvas to a target size — what the arena used to do — therefore made
// two same-size Pokémon land at very different on-screen sizes, and at
// different magnifications, so their pixel art didn't even have the same
// pixel size. The arena now scales the visible body instead (see
// computeOnScreenSizeFromBody in src/sim/constants.ts), which needs these
// measurements up front: the sim derives each Pokémon's collision radius
// from them before any sheet is loaded, on the game server too, so they
// have to be bundled data rather than read off the sheets at runtime.
//
// Reads pmd-sprite-mirror/ (the raw fetch — see fetch-pmd-sprites.ts) and
// the index's base (non-shiny) entries; a shiny is a recolor, same pixels.
// Re-run after any fetch that adds or replaces species
// (check-pmd-sprite-updates.ts --apply does so itself).
//
//   npm run data:measure-pmd-bodies

const MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;
export const PMD_BODY_SIZES_PATH = new URL('../src/data/generated/pmdBodySizes.json', import.meta.url).pathname;
/** The action that decides a species' size: its standing silhouette, in
 * every facing (a long-bodied quadruped is wider side-on than head-on).
 * Walk's stride sweep — legs and tails swinging well past the standing
 * silhouette — would inflate exactly those species by up to ~60%, and
 * Attack/Hurt/etc. lunge and recoil further still. */
const MEASURED_ACTIONS = ['Idle'] as const;
const CONCURRENCY = 8;

export type PmdBodySizes = Record<string, [width: number, height: number]>;

interface Box {
  width: number;
  height: number;
}

/** The largest silhouette in any one facing: per sheet row (one per
 * direction), the union of the visible-pixel bounding boxes of that row's
 * frames, measured in each frame's own coordinates (a direction's frames
 * share one anchor, so the union is the pose's full sweep); then the widest
 * and tallest of those. Not the union across rows — a body facing W sits on
 * the other side of the anchor from one facing E, so that would measure
 * two sprites side by side. */
async function measureSheet(path: string, meta: PmdAnimEntry): Promise<Box | null> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const frameWidth = meta.frameWidth;
  const frameHeight = meta.frameHeight;
  if (frameWidth <= 0 || frameHeight <= 0) return null;
  const cols = Math.max(1, Math.round(width / frameWidth));
  const rows = Math.max(1, Math.round(height / frameHeight));

  let widest = 0;
  let tallest = 0;
  for (let row = 0; row < rows; row++) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let col = 0; col < cols; col++) {
      for (let y = 0; y < frameHeight; y++) {
        const sheetY = row * frameHeight + y;
        if (sheetY >= height) break;
        for (let x = 0; x < frameWidth; x++) {
          const sheetX = col * frameWidth + x;
          if (sheetX >= width) break;
          if (data[(sheetY * width + sheetX) * channels + 3] === 0) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) continue; // a fully transparent row
    widest = Math.max(widest, maxX - minX + 1);
    tallest = Math.max(tallest, maxY - minY + 1);
  }
  if (widest === 0 || tallest === 0) return null; // a fully transparent sheet
  return { width: widest, height: tallest };
}

async function measureSpecies(entry: PmdSpriteIndex[string]): Promise<[number, number] | null> {
  let width = 0;
  let height = 0;
  for (const action of MEASURED_ACTIONS) {
    const meta = entry.actions[action];
    if (!meta) continue;
    const box = await measureSheet(`${MIRROR_ROOT}${entry.dir}/${action}-Anim.png`, meta);
    if (!box) continue;
    width = Math.max(width, box.width);
    height = Math.max(height, box.height);
  }
  return width > 0 && height > 0 ? [width, height] : null;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const index = JSON.parse(await readFile(PMD_SPRITE_INDEX_PATH, 'utf-8')) as PmdSpriteIndex;
  const ids = Object.keys(index)
    .map(Number)
    .sort((a, b) => a - b);
  console.log(`[measure-pmd-bodies] measuring ${ids.length} species from ${MIRROR_ROOT}`);

  const sizes: PmdBodySizes = {};
  const failed: number[] = [];
  await mapWithConcurrency(ids, async (id) => {
    try {
      const size = await measureSpecies(index[String(id)]);
      if (size) sizes[String(id)] = size;
      else failed.push(id);
    } catch (err) {
      failed.push(id);
      console.error(`[measure-pmd-bodies] ${id}: ${(err as Error).message}`);
    }
  }, undefined, CONCURRENCY);

  // Sorted by id so the file diffs cleanly when a species is re-measured.
  const sorted: PmdBodySizes = {};
  for (const id of ids) if (sizes[String(id)]) sorted[String(id)] = sizes[String(id)];
  await writeFile(PMD_BODY_SIZES_PATH, `${JSON.stringify(sorted)}\n`, 'utf-8');

  const longest = Object.values(sorted).map(([w, h]) => Math.max(w, h)).sort((a, b) => a - b);
  const at = (fraction: number): number => longest[Math.min(longest.length - 1, Math.floor(longest.length * fraction))];
  console.log(
    `[measure-pmd-bodies] wrote ${Object.keys(sorted).length} sizes to ${PMD_BODY_SIZES_PATH} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
      ` (longest side: min ${longest[0]}, median ${at(0.5)}, p90 ${at(0.9)}, max ${longest[longest.length - 1]}px)`
  );
  if (failed.length) console.warn(`[measure-pmd-bodies] ${failed.length} species could not be measured: ${failed.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
