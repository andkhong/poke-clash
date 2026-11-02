import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PmdSpriteIndex } from '../src/data/types';

// The PMD sprite index is written to three places by the fetch scripts
// (fetch-pmd-sprites.ts, fetch-pmd-shiny-sprites.ts, check-pmd-sprite-updates.ts):
//
// - public/pmd-sprite-index.json: the full per-species frame metadata
//   (~1.4 MB), which only the arena needs and only once a match starts.
//   It's served as a static file and fetched by ArenaScene's preload,
//   versioned alongside the sheets it describes (see
//   src/render/sprites/pmdSheetUrl.ts), instead of being bundled into the
//   JavaScript every visitor downloads before seeing the menu.
// - src/data/generated/pmdSpriteIds.json: just the species ids in the
//   index, a few KB, for the code that runs before a match (roster
//   selection in src/data/loader.ts, the game server) and only needs to
//   know whether a species has PMD art.
// - src/data/generated/pmdSpriteIndexVersion.json: a digest of the index,
//   which pmdSheetUrl.ts puts in the index's URL so a regenerated index is
//   never served from a browser's year-long cache of the old one.
// - src/data/generated/kantoIdleSprites.json: just the Idle sheet of each of
//   the original 151 (Play Mode's roster), a few KB, for the landing page's
//   court pictures, which can't afford the full index.
// - src/data/generated/idleSprites.json: the same for Gens 1–4 (ids up to
//   493), for the lobby's species sprites.
//
// Every entry also gets a `version` tag derived from when it was fetched
// (and its shiny its own), which goes into that species' sheet URLs: when
// an upstream update replaces a species' sheets on the volume, only that
// species' URLs change, and everyone else's stay cached.
export const PMD_SPRITE_INDEX_PATH = new URL('../public/pmd-sprite-index.json', import.meta.url).pathname;
export const PMD_SPRITE_IDS_PATH = new URL('../src/data/generated/pmdSpriteIds.json', import.meta.url).pathname;
export const PMD_SPRITE_INDEX_VERSION_PATH = new URL('../src/data/generated/pmdSpriteIndexVersion.json', import.meta.url).pathname;
export const KANTO_IDLE_SPRITES_PATH = new URL('../src/data/generated/kantoIdleSprites.json', import.meta.url).pathname;
export const IDLE_SPRITES_PATH = new URL('../src/data/generated/idleSprites.json', import.meta.url).pathname;
/** Last national dex id of Gen 4 (Arceus). */
export const IDLE_SPRITES_MAX_ID = 493;

/** Per species id: [sheet dir, version, frame width, frame height, frame count, loop ms] of its Idle sheet. */
export type KantoIdleSprites = Record<string, [string, string, number, number, number, number]>;

export function buildKantoIdleSprites(index: PmdSpriteIndex, maxId = 151): KantoIdleSprites {
  const out: KantoIdleSprites = {};
  for (const [id, entry] of Object.entries(index)) {
    const idle = entry.actions.Idle;
    if (Number(id) > maxId || !idle) continue;
    const loopMs = idle.durationsMs.reduce((sum, ms) => sum + ms, 0);
    out[id] = [entry.dir, entry.version ?? '0', idle.frameWidth, idle.frameHeight, idle.durationsMs.length, loopMs];
  }
  return out;
}

/** A short cache tag for a fetch time: seconds since the epoch in base 36. */
export function versionTag(isoDate: string | undefined): string {
  const ms = isoDate ? Date.parse(isoDate) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000).toString(36) : '0';
}

export async function writePmdSpriteIndex(index: PmdSpriteIndex): Promise<void> {
  for (const entry of Object.values(index)) {
    entry.version = versionTag(entry.generatedAt);
    if (entry.shiny) entry.shiny.version = versionTag(entry.shiny.generatedAt ?? entry.generatedAt);
  }
  const json = JSON.stringify(index);
  await mkdir(dirname(PMD_SPRITE_INDEX_PATH), { recursive: true });
  await writeFile(PMD_SPRITE_INDEX_PATH, json, 'utf-8');
  const ids = Object.keys(index)
    .map(Number)
    .sort((a, b) => a - b);
  await mkdir(dirname(PMD_SPRITE_IDS_PATH), { recursive: true });
  await writeFile(PMD_SPRITE_IDS_PATH, JSON.stringify(ids), 'utf-8');
  const version = createHash('sha1').update(json).digest('hex').slice(0, 10);
  await writeFile(PMD_SPRITE_INDEX_VERSION_PATH, `${JSON.stringify({ version })}\n`, 'utf-8');
  await writeFile(KANTO_IDLE_SPRITES_PATH, `${JSON.stringify(buildKantoIdleSprites(index))}\n`, 'utf-8');
  await writeFile(IDLE_SPRITES_PATH, `${JSON.stringify(buildKantoIdleSprites(index, IDLE_SPRITES_MAX_ID))}\n`, 'utf-8');
}
