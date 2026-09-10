import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mapWithConcurrency } from './pokeapi';
import { extractCoreActions, fetchZipWithRetry } from './pmdSpriteZip';
import { PMD_SPRITE_INDEX_PATH, writePmdSpriteIndex } from './pmdSpriteIndexFiles';
import type { PmdSpriteIndex } from '../src/data/types';

// Downloads REAL shiny recolor sprites from PMDCollab/SpriteCollab — a
// genuinely different, hand-authored per-species color palette, NOT a
// uniform tint. Layered on top of fetch-pmd-sprites.ts: only species that
// already have normal PMD coverage are candidates, and this script *merges*
// a `shiny` sub-object into their existing pmdSpriteIndex.json entry rather
// than writing a separate index.
//
// PMDCollab's REST endpoint (used by fetch-pmd-sprites.ts) only ever serves
// a species' default color. The shiny variant lives at a different internal
// form/color path that varies in depth per species (regular forms, gendered
// forms, costumes, ...), so there's no simple URL pattern to guess. Their
// GraphQL API resolves this properly: querying a monster's `forms` returns
// every form/color/gender combination with an `isShiny` flag and a direct
// `sprites.zipUrl` — verified empirically that across every species checked
// (Pikachu, Bulbasaur, Charizard, Snorlax, ...), the shiny recolor of a
// species' own default form always has the exact form path "0000/0001".
const GRAPHQL_URL = 'https://spriteserver.pmdcollab.org/graphql';
const SHINY_FORM_PATH = '0000/0001';

const INDEX_PATH = PMD_SPRITE_INDEX_PATH;
const STATUS_CACHE_PATH = new URL('./cache/pmdShinySpriteFetch.json', import.meta.url).pathname;
const RAW_ZIP_CACHE_DIR = new URL('./cache/pmd-shiny-sprites-raw/', import.meta.url).pathname;
const MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;

// Same roster as fetch-pmd-sprites.ts's smoke test — good species-diversity
// coverage for a quick check before committing to the full run.
const SMOKE_TEST_SPECIES_IDS = [25, 6, 150, 100, 73, 68, 282, 666, 59, 906, 129, 321, 143, 94, 401];

const GRAPHQL_BATCH_SIZE = 50;

type FetchStatus = { status: 'done' } | { status: 'unavailable' } | { status: 'failed'; error: string };
type StatusCache = Record<string, FetchStatus>;

async function loadJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

async function resolveSpeciesIds(index: PmdSpriteIndex): Promise<number[]> {
  const explicit = process.env.PMD_SHINY_SPRITE_SPECIES_IDS;
  if (explicit) {
    return explicit
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  }
  // Shiny only makes sense layered on a species that already has normal PMD
  // coverage — the index (built by fetch-pmd-sprites.ts) is the source of truth.
  const covered = Object.keys(index).map(Number);
  if (process.env.PMD_SHINY_SPRITE_ALL === 'true') return covered;
  const smokeTestSet = new Set(SMOKE_TEST_SPECIES_IDS);
  return covered.filter((id) => smokeTestSet.has(id));
}

interface GraphQlForm {
  path: string;
  sprites: { zipUrl: string | null };
}

// Resolves each requested species to its shiny-of-default zipUrl (or null if
// PMDCollab has no shiny recolor for it yet), batching the GraphQL query so a
// full-roster run doesn't send 1000+ separate requests just to find URLs.
async function resolveShinyZipUrls(speciesIds: number[]): Promise<Map<number, string | null>> {
  const result = new Map<number, string | null>();
  for (let i = 0; i < speciesIds.length; i += GRAPHQL_BATCH_SIZE) {
    const batch = speciesIds.slice(i, i + GRAPHQL_BATCH_SIZE);
    const query = `{ monster(filter: [${batch.join(',')}]) { id forms { path sprites { zipUrl } } } }`;
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    const json = (await res.json()) as { data?: { monster: { id: number; forms: GraphQlForm[] }[] }; errors?: unknown };
    if (!json.data) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    for (const m of json.data.monster) {
      const shinyForm = m.forms.find((f) => f.path === SHINY_FORM_PATH);
      result.set(m.id, shinyForm?.sprites.zipUrl ?? null);
    }
    console.log(`[fetch-pmd-shiny-sprites] resolved zip URLs for ${Math.min(i + GRAPHQL_BATCH_SIZE, speciesIds.length)}/${speciesIds.length}`);
  }
  return result;
}

async function getZipBuffer(paddedId: string, zipUrl: string): Promise<Buffer | 'unavailable'> {
  const cachePath = `${RAW_ZIP_CACHE_DIR}${paddedId}.zip`;
  try {
    return await readFile(cachePath);
  } catch {
    // not cached yet, fall through to fetch
  }
  const result = await fetchZipWithRetry(zipUrl);
  if (result === 'unavailable') return result;
  await mkdir(RAW_ZIP_CACHE_DIR, { recursive: true });
  await writeFile(cachePath, result);
  return result;
}

async function processSpecies(
  id: number,
  zipUrl: string | null,
  index: PmdSpriteIndex,
  statusCache: StatusCache
): Promise<void> {
  const key = String(id);
  const force = process.env.PMD_SHINY_SPRITE_FORCE === 'true';
  if (!force && statusCache[key] && statusCache[key].status !== 'failed') return;

  if (!zipUrl) {
    statusCache[key] = { status: 'unavailable' };
    return;
  }

  const paddedId = key.padStart(4, '0');

  let zipBuffer: Buffer | 'unavailable';
  try {
    zipBuffer = await getZipBuffer(paddedId, zipUrl);
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

  const shinyDirName = `${paddedId}-shiny`;
  const speciesDir = `${MIRROR_ROOT}${shinyDirName}/`;
  await mkdir(speciesDir, { recursive: true });
  await Promise.all(Object.entries(extracted.pngsToWrite).map(([name, buf]) => writeFile(`${speciesDir}${name}`, buf)));

  const existing = index[key];
  if (!existing) {
    // Shouldn't happen (resolveSpeciesIds only offers already-covered
    // species), but don't silently fabricate a normal-tier entry if it does.
    statusCache[key] = { status: 'failed', error: 'no existing normal-tier index entry to attach shiny to' };
    return;
  }
  existing.shiny = { dir: shinyDirName, actions: extracted.actions, generatedAt: new Date().toISOString() };
  statusCache[key] = { status: 'done' };
}

async function persist(index: PmdSpriteIndex, statusCache: StatusCache): Promise<void> {
  await writePmdSpriteIndex(index);
  await mkdir(new URL('./cache/', import.meta.url).pathname, { recursive: true });
  await writeFile(STATUS_CACHE_PATH, JSON.stringify(statusCache), 'utf-8');
}

async function main(): Promise<void> {
  const index = await loadJsonOrDefault<PmdSpriteIndex>(INDEX_PATH, {});
  const statusCache = await loadJsonOrDefault<StatusCache>(STATUS_CACHE_PATH, {});
  const speciesIds = await resolveSpeciesIds(index);

  console.log(`[fetch-pmd-shiny-sprites] ${speciesIds.length} species requested`);

  const zipUrls = await resolveShinyZipUrls(speciesIds);
  const concurrency = Number(process.env.PMD_SHINY_SPRITE_CONCURRENCY ?? 6);

  let done = 0;
  await mapWithConcurrency(
    speciesIds,
    async (id) => {
      await processSpecies(id, zipUrls.get(id) ?? null, index, statusCache);
      done += 1;
      if (done % 25 === 0 || done === speciesIds.length) {
        console.log(`[fetch-pmd-shiny-sprites] ${done}/${speciesIds.length}`);
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
  console.log('[fetch-pmd-shiny-sprites] status breakdown:', counts);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
