import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { toShowdownSlug } from '../src/data/showdownSlug';
import { mapWithConcurrency } from './pokeapi';
import type { SpriteIndex, SpriteIndexEntry, SpriteTier } from '../src/data/types';

const POKEMON_JSON_PATH = new URL('../src/data/generated/pokemon.json', import.meta.url).pathname;
const OUTPUT_PATH = new URL('../src/data/generated/spriteIndex.json', import.meta.url).pathname;
const CACHE_PATH = new URL('./cache/spriteProbe.json', import.meta.url).pathname;

// This is a best-effort BUILD-TIME HINT, not a guarantee — see spriteResolver.ts
// for the runtime onerror fallback chain every species still goes through
// regardless. Its only job is correct-on-first-paint for the common case.
async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

async function probeOne(slug: string): Promise<SpriteTier> {
  const [aniFront, aniBack] = await Promise.all([
    headOk(`https://play.pokemonshowdown.com/sprites/ani/${slug}.gif`),
    headOk(`https://play.pokemonshowdown.com/sprites/ani-back/${slug}.gif`),
  ]);
  if (aniFront && aniBack) return 'animated';

  const gen5 = await headOk(`https://play.pokemonshowdown.com/sprites/gen5/${slug}.png`);
  if (gen5) return 'static-gen5';

  return 'static-official'; // PokeAPI official-artwork is assumed always present for ids 1-1025
}

async function loadExistingCache(): Promise<SpriteIndex> {
  try {
    return JSON.parse(await readFile(CACHE_PATH, 'utf-8')) as SpriteIndex;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const species = JSON.parse(await readFile(POKEMON_JSON_PATH, 'utf-8')) as { id: number; name: string }[];
  const existing = await loadExistingCache();
  const index: SpriteIndex = { ...existing };

  const todo = species.filter((s) => !index[String(s.id)]);
  console.log(`[probe-sprites] ${species.length} species, ${todo.length} not yet probed`);

  let done = 0;
  await mapWithConcurrency(todo, async (s) => {
    const slug = toShowdownSlug(s.name);
    const tier = await probeOne(slug);
    const entry: SpriteIndexEntry = { slug, tier };
    index[String(s.id)] = entry;
    done += 1;
    if (done % 50 === 0 || done === todo.length) {
      console.log(`[probe-sprites] ${done}/${todo.length}`);
      await mkdir(new URL('./cache/', import.meta.url).pathname, { recursive: true });
      await writeFile(CACHE_PATH, JSON.stringify(index), 'utf-8'); // incremental save, resumable
    }
  });

  // fetch-fallback-sprites.ts records locally mirrored files on these same
  // entries; a re-probe must not throw that away (the tier it reports can
  // be stale, the mirrored file is what actually plays).
  let published: SpriteIndex = {};
  try {
    published = JSON.parse(await readFile(OUTPUT_PATH, 'utf-8')) as SpriteIndex;
  } catch {
    // first run — nothing to preserve
  }
  for (const [id, entry] of Object.entries(published)) {
    if (entry.local && index[id]) index[id] = { ...index[id], tier: entry.tier, local: entry.local };
  }

  await mkdir(new URL('../src/data/generated/', import.meta.url).pathname, { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(index), 'utf-8');

  const tierCounts = Object.values(index).reduce<Record<string, number>>((acc, e) => {
    acc[e.tier] = (acc[e.tier] ?? 0) + 1;
    return acc;
  }, {});
  console.log('[probe-sprites] tier breakdown:', tierCounts);
  console.log(`[probe-sprites] wrote ${Object.keys(index).length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
