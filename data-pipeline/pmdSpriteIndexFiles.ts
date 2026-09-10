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
//
// Every entry also gets a `version` tag derived from when it was fetched
// (and its shiny its own), which goes into that species' sheet URLs: when
// an upstream update replaces a species' sheets on the volume, only that
// species' URLs change, and everyone else's stay cached.
export const PMD_SPRITE_INDEX_PATH = new URL('../public/pmd-sprite-index.json', import.meta.url).pathname;
export const PMD_SPRITE_IDS_PATH = new URL('../src/data/generated/pmdSpriteIds.json', import.meta.url).pathname;
export const PMD_SPRITE_INDEX_VERSION_PATH = new URL('../src/data/generated/pmdSpriteIndexVersion.json', import.meta.url).pathname;

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
}
