import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mapWithConcurrency } from './pokeapi';
import { extractCoreActions, fetchZipWithRetry } from './pmdSpriteZip';
import type { PmdSpriteIndex } from '../src/data/types';

// Downloads animated battle sprites from PMDCollab/SpriteCollab (the sprite
// database behind the Pokemon Mystery Dungeon fan-tooling ecosystem) via their
// dedicated asset server — NOT github.com/api.github.com, so no GitHub API
// rate limits are involved. This is a one-time/resumable local mirror step:
// raw PNGs land in pmd-sprite-mirror/ (gitignored, served by sprite-server/),
// while a small parsed-metadata index is committed to src/data/generated/ so
// the client never fetches or parses AnimData.xml at runtime.
const POKEMON_JSON_PATH = new URL('../src/data/generated/pokemon.json', import.meta.url).pathname;
const OUTPUT_INDEX_PATH = new URL('../src/data/generated/pmdSpriteIndex.json', import.meta.url).pathname;
const STATUS_CACHE_PATH = new URL('./cache/pmdSpriteFetch.json', import.meta.url).pathname;
const RAW_ZIP_CACHE_DIR = new URL('./cache/pmd-sprites-raw/', import.meta.url).pathname;
const MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;

// Same roster as the removed generate-pixel-sprites.ts pilot batch — good
// species-diversity coverage (mascot, starter, legendary, size extremes,
// humanoid/patterned/simple/complex silhouettes) for a quick smoke test.
const SMOKE_TEST_SPECIES_IDS = [25, 6, 150, 100, 73, 68, 282, 666, 59, 906, 129, 321, 143, 94, 401];

type FetchStatus = { status: 'done' } | { status: 'unavailable' } | { status: 'failed'; error: string };
type StatusCache = Record<string, FetchStatus>;

function spriteZipUrl(paddedId: string): string {
  return `https://spriteserver.pmdcollab.org/assets/${paddedId}/sprites.zip`;
}

async function loadJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

async function resolveSpeciesIds(): Promise<number[]> {
  const explicit = process.env.PMD_SPRITE_SPECIES_IDS;
  if (explicit) {
    return explicit
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  if (process.env.PMD_SPRITE_ALL === 'true') {
    const species = await loadJsonOrDefault<{ id: number }[]>(POKEMON_JSON_PATH, []);
    return species.map((s) => s.id);
  }
  return SMOKE_TEST_SPECIES_IDS;
}

async function getZipBuffer(paddedId: string): Promise<Buffer | 'unavailable'> {
  const cachePath = `${RAW_ZIP_CACHE_DIR}${paddedId}.zip`;
  try {
    return await readFile(cachePath);
  } catch {
    // not cached yet, fall through to fetch
  }
  const result = await fetchZipWithRetry(spriteZipUrl(paddedId));
  if (result === 'unavailable') return result;
  await mkdir(RAW_ZIP_CACHE_DIR, { recursive: true });
  await writeFile(cachePath, result);
  return result;
}

async function processSpecies(id: number, index: PmdSpriteIndex, statusCache: StatusCache): Promise<void> {
  const key = String(id);
  const force = process.env.PMD_SPRITE_FORCE === 'true';
  if (!force && statusCache[key] && statusCache[key].status !== 'failed') return;

  const paddedId = key.padStart(4, '0');

  let zipBuffer: Buffer | 'unavailable';
  try {
    zipBuffer = await getZipBuffer(paddedId);
  } catch (err) {
    statusCache[key] = { status: 'failed', error: String(err) };
    return;
  }
  if (zipBuffer === 'unavailable') {
    statusCache[key] = { status: 'unavailable' };
    return;
  }

  let extracted: Awaited<ReturnType<typeof extractCoreActions>>;
  try {
    extracted = await extractCoreActions(zipBuffer);
  } catch (err) {
    statusCache[key] = { status: 'failed', error: String(err) };
    return;
  }
  if (!extracted) {
    statusCache[key] = { status: 'unavailable' };
    return;
  }

  const speciesDir = `${MIRROR_ROOT}${paddedId}/`;
  await mkdir(speciesDir, { recursive: true });
  await Promise.all(Object.entries(extracted.pngsToWrite).map(([name, buf]) => writeFile(`${speciesDir}${name}`, buf)));

  index[key] = { dir: paddedId, actions: extracted.actions, generatedAt: new Date().toISOString() };
  statusCache[key] = { status: 'done' };
}

async function persist(index: PmdSpriteIndex, statusCache: StatusCache): Promise<void> {
  await mkdir(new URL('../src/data/generated/', import.meta.url).pathname, { recursive: true });
  await writeFile(OUTPUT_INDEX_PATH, JSON.stringify(index), 'utf-8');
  await mkdir(new URL('./cache/', import.meta.url).pathname, { recursive: true });
  await writeFile(STATUS_CACHE_PATH, JSON.stringify(statusCache), 'utf-8');
}

async function main(): Promise<void> {
  const speciesIds = await resolveSpeciesIds();
  const index = await loadJsonOrDefault<PmdSpriteIndex>(OUTPUT_INDEX_PATH, {});
  const statusCache = await loadJsonOrDefault<StatusCache>(STATUS_CACHE_PATH, {});
  const concurrency = Number(process.env.PMD_SPRITE_CONCURRENCY ?? 6);

  console.log(`[fetch-pmd-sprites] ${speciesIds.length} species requested (concurrency ${concurrency})`);

  let done = 0;
  await mapWithConcurrency(
    speciesIds,
    async (id) => {
      await processSpecies(id, index, statusCache);
      done += 1;
      if (done % 25 === 0 || done === speciesIds.length) {
        console.log(`[fetch-pmd-sprites] ${done}/${speciesIds.length}`);
        await persist(index, statusCache);
      }
    },
    undefined,
    concurrency
  );

  await persist(index, statusCache);

  const counts = Object.values(statusCache).reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('[fetch-pmd-sprites] status breakdown:', counts);
  console.log(`[fetch-pmd-sprites] wrote ${Object.keys(index).length} entries to ${OUTPUT_INDEX_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
