import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PmdSpriteIndex } from '../src/data/types';

// The PMD sprite index is written to two places by the fetch scripts
// (fetch-pmd-sprites.ts, fetch-pmd-shiny-sprites.ts):
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
export const PMD_SPRITE_INDEX_PATH = new URL('../public/pmd-sprite-index.json', import.meta.url).pathname;
export const PMD_SPRITE_IDS_PATH = new URL('../src/data/generated/pmdSpriteIds.json', import.meta.url).pathname;

export async function writePmdSpriteIndex(index: PmdSpriteIndex): Promise<void> {
  await mkdir(dirname(PMD_SPRITE_INDEX_PATH), { recursive: true });
  await writeFile(PMD_SPRITE_INDEX_PATH, JSON.stringify(index), 'utf-8');
  const ids = Object.keys(index)
    .map(Number)
    .sort((a, b) => a - b);
  await writeFile(PMD_SPRITE_IDS_PATH, JSON.stringify(ids), 'utf-8');
}
