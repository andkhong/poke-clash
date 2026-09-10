import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { toShowdownSlug } from '../src/data/showdownSlug';
import type { PmdSpriteIndex, SpriteIndex, SpriteIndexEntry, SpriteTier } from '../src/data/types';
import { mapWithConcurrency } from './pokeapi';

// Mirrors the fallback art for every species that has no PMDCollab sprites
// (63 of 1,025 at the time of writing) into public/fallback-sprites/, which
// is committed and ships with the build like public/cries/ does, and
// records the local paths on the species' spriteIndex.json entry. Until
// this existed those species were hotlinked at match time from
// play.pokemonshowdown.com and raw.githubusercontent.com — a third-party
// availability (and etiquette) dependency in production for a few MB of
// files.
//
// Tiers are tried in the same order the runtime resolver falls back
// through (see spriteResolver.ts): Showdown's animated GIF pair, then its
// static gen-5 PNG pair, then PokeAPI's official artwork (front only; the
// back view reuses it). The tier that actually downloads is what gets
// recorded, so the hint from probe-sprites.ts is corrected if it's stale.
//
// Re-running only fetches species whose files are missing (or all of them
// with --force).
const POKEMON_JSON_PATH = new URL('../src/data/generated/pokemon.json', import.meta.url).pathname;
const PMD_INDEX_PATH = new URL('../src/data/generated/pmdSpriteIndex.json', import.meta.url).pathname;
const SPRITE_INDEX_PATH = new URL('../src/data/generated/spriteIndex.json', import.meta.url).pathname;
const OUTPUT_DIR = new URL('../public/fallback-sprites/', import.meta.url).pathname;
const PUBLIC_PREFIX = '/fallback-sprites/';

interface TierSource {
  tier: SpriteTier;
  ext: 'gif' | 'png';
  front: (slug: string, id: number) => string;
  /** null = no back view exists for this tier; the front is reused. */
  back: ((slug: string, id: number) => string) | null;
}

const TIERS: TierSource[] = [
  {
    tier: 'animated',
    ext: 'gif',
    front: (slug) => `https://play.pokemonshowdown.com/sprites/ani/${slug}.gif`,
    back: (slug) => `https://play.pokemonshowdown.com/sprites/ani-back/${slug}.gif`,
  },
  {
    tier: 'static-gen5',
    ext: 'png',
    front: (slug) => `https://play.pokemonshowdown.com/sprites/gen5/${slug}.png`,
    back: (slug) => `https://play.pokemonshowdown.com/sprites/gen5-back/${slug}.png`,
  },
  {
    tier: 'static-official',
    ext: 'png',
    front: (_slug, id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
    back: null,
  },
];

async function download(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const species = JSON.parse(await readFile(POKEMON_JSON_PATH, 'utf-8')) as { id: number; name: string }[];
  const pmd = JSON.parse(await readFile(PMD_INDEX_PATH, 'utf-8')) as PmdSpriteIndex;
  const index = JSON.parse(await readFile(SPRITE_INDEX_PATH, 'utf-8')) as SpriteIndex;
  await mkdir(OUTPUT_DIR, { recursive: true });

  const needsFallback = species.filter((s) => !pmd[String(s.id)]);
  console.log(`[fetch-fallback-sprites] ${needsFallback.length} species without PMD sprites`);

  let fetched = 0;
  let kept = 0;
  let failed = 0;
  let bytes = 0;
  const tierCounts: Record<string, number> = {};

  await mapWithConcurrency(needsFallback, async (s) => {
    const key = String(s.id);
    const existing = index[key];
    if (!force && existing?.local && (await exists(`${OUTPUT_DIR}${existing.local.front.slice(PUBLIC_PREFIX.length)}`))) {
      kept += 1;
      tierCounts[existing.tier] = (tierCounts[existing.tier] ?? 0) + 1;
      return;
    }
    const slug = existing?.slug ?? toShowdownSlug(s.name);

    for (const source of TIERS) {
      const front = await download(source.front(slug, s.id));
      if (!front) continue;
      const back = source.back ? await download(source.back(slug, s.id)) : front;
      if (!back) continue;

      const frontFile = `${s.id}-front.${source.ext}`;
      const backFile = source.back ? `${s.id}-back.${source.ext}` : frontFile;
      await writeFile(`${OUTPUT_DIR}${frontFile}`, front);
      if (source.back) await writeFile(`${OUTPUT_DIR}${backFile}`, back);
      bytes += front.length + (source.back ? back.length : 0);

      const entry: SpriteIndexEntry = {
        slug,
        tier: source.tier,
        local: { front: `${PUBLIC_PREFIX}${frontFile}`, back: `${PUBLIC_PREFIX}${backFile}` },
      };
      index[key] = entry;
      fetched += 1;
      tierCounts[source.tier] = (tierCounts[source.tier] ?? 0) + 1;
      return;
    }
    failed += 1;
    console.warn(`[fetch-fallback-sprites] ${s.id} ${s.name}: no tier available`);
  });

  await writeFile(SPRITE_INDEX_PATH, JSON.stringify(index), 'utf-8');
  console.log(
    `[fetch-fallback-sprites] fetched ${fetched} (${(bytes / 1048576).toFixed(1)} MB), already mirrored ${kept}, failed ${failed}; tiers: ${JSON.stringify(tierCounts)}`
  );
  console.log(`[fetch-fallback-sprites] wrote ${OUTPUT_DIR} and updated ${SPRITE_INDEX_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
