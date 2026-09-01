import { mkdir, writeFile } from 'node:fs/promises';
import { fetchPokemonRange } from './fetch-pokemon';
import { fetchMoves } from './fetch-moves';
import { classifyMove } from './classify-move-effects';
import type { ApiPokemon } from './pokeApiTypes';
import type { MoveDefinition, PokemonTypeName, StatBlock } from '../src/sim/types';
import type { GeneratedSpecies } from '../src/data/types';

// As of the Scarlet/Violet DLC (The Indigo Disk), the National Pokédex runs
// through #1025 (Pecharunt). Override via POKEMON_MAX_ID env var for a quick
// partial run (e.g. `POKEMON_MAX_ID=151` for just Gen 1) during development.
const DEFAULT_MAX_ID = 1025;
const MAX_ID = Number(process.env.POKEMON_MAX_ID ?? DEFAULT_MAX_ID);
const MIN_ID = Number(process.env.POKEMON_MIN_ID ?? 1);

const OUTPUT_DIR = new URL('../src/data/generated/', import.meta.url).pathname;

// Newest-to-oldest: each species uses the first version group it actually has
// move data for, so a species only ever gets ONE learnset (no cross-generation
// mixing), while every species (however old or new) still resolves to something.
const VERSION_GROUP_PREFERENCE = [
  'scarlet-violet',
  'legends-arceus',
  'brilliant-diamond-and-shining-pearl',
  'sword-shield',
  'lets-go-pikachu-lets-go-eevee',
  'ultra-sun-ultra-moon',
  'sun-moon',
  'omega-ruby-alpha-sapphire',
  'x-y',
  'black-2-white-2',
  'black-white',
  'heartgold-soulsilver',
  'platinum',
  'diamond-pearl',
  'emerald',
  'firered-leafgreen',
  'ruby-sapphire',
  'crystal',
  'gold-silver',
  'yellow',
  'red-blue',
];

const STAT_NAME_TO_KEY: Record<string, keyof StatBlock> = {
  hp: 'hp',
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
};

function extractIdFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/);
  if (!match) throw new Error(`Could not extract id from ${url}`);
  return Number(match[1]);
}

function selectVersionGroup(pokemon: ApiPokemon): string | null {
  const available = new Set<string>();
  for (const m of pokemon.moves) {
    for (const vgd of m.version_group_details) available.add(vgd.version_group.name);
  }
  for (const vg of VERSION_GROUP_PREFERENCE) {
    if (available.has(vg)) return vg;
  }
  const first = available.values().next();
  return first.done ? null : first.value;
}

function extractLearnset(
  pokemon: ApiPokemon,
  versionGroup: string
): { levelUpMoves: { moveId: number; level: number }[]; tmMoveIds: number[] } {
  const levelUpByMove = new Map<number, number>();
  const tmMoveIds = new Set<number>();

  for (const m of pokemon.moves) {
    const moveId = extractIdFromUrl(m.move.url);
    for (const vgd of m.version_group_details) {
      if (vgd.version_group.name !== versionGroup) continue;
      if (vgd.move_learn_method.name === 'level-up') {
        const level = Math.max(1, vgd.level_learned_at);
        const existing = levelUpByMove.get(moveId);
        if (existing === undefined || level < existing) levelUpByMove.set(moveId, level);
      } else if (vgd.move_learn_method.name === 'machine') {
        tmMoveIds.add(moveId);
      }
    }
  }

  return {
    levelUpMoves: [...levelUpByMove.entries()].map(([moveId, level]) => ({ moveId, level })),
    tmMoveIds: [...tmMoveIds],
  };
}

function extractBaseStats(pokemon: ApiPokemon): StatBlock {
  const stats: Partial<StatBlock> = {};
  for (const s of pokemon.stats) {
    const key = STAT_NAME_TO_KEY[s.stat.name];
    if (key) stats[key] = s.base_stat;
  }
  const required: (keyof StatBlock)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  for (const key of required) {
    if (stats[key] === undefined) throw new Error(`Missing stat ${key} for ${pokemon.name}`);
  }
  return stats as StatBlock;
}

async function main(): Promise<void> {
  console.log(`[build-dataset] fetching Pokémon ${MIN_ID}-${MAX_ID}...`);
  const pokemonList = await fetchPokemonRange(MIN_ID, MAX_ID, (done, total) => {
    if (done % 50 === 0 || done === total) console.log(`[build-dataset] pokemon ${done}/${total}`);
  });
  console.log(`[build-dataset] fetched ${pokemonList.length} species`);

  const referencedMoveIds = new Set<number>();
  for (const p of pokemonList) {
    for (const m of p.moves) referencedMoveIds.add(extractIdFromUrl(m.move.url));
  }
  console.log(`[build-dataset] fetching ${referencedMoveIds.size} referenced moves...`);
  const apiMoves = await fetchMoves([...referencedMoveIds], (done, total) => {
    if (done % 100 === 0 || done === total) console.log(`[build-dataset] moves ${done}/${total}`);
  });

  const movesById = new Map<number, MoveDefinition>();
  let excludedCount = 0;
  for (const api of apiMoves) {
    const classified = classifyMove(api);
    if (classified) movesById.set(classified.id, classified);
    else excludedCount += 1;
  }
  console.log(
    `[build-dataset] classified ${movesById.size} supported moves, excluded ${excludedCount} unsupported`
  );

  const species: GeneratedSpecies[] = [];
  const sparsePool: string[] = [];

  for (const pokemon of pokemonList) {
    const versionGroup = selectVersionGroup(pokemon);
    if (!versionGroup) {
      console.warn(`[build-dataset] ${pokemon.name}: no version group data, skipping`);
      continue;
    }
    const { levelUpMoves, tmMoveIds } = extractLearnset(pokemon, versionGroup);

    const supportedLevelUp = levelUpMoves.filter((m) => movesById.has(m.moveId));
    const supportedTm = tmMoveIds.filter((id) => movesById.has(id));

    const totalPool = new Set([...supportedLevelUp.map((m) => m.moveId), ...supportedTm]);
    if (totalPool.size < 4) {
      sparsePool.push(`${pokemon.name} (${totalPool.size})`);
    }

    species.push({
      id: pokemon.id,
      name: pokemon.species.name,
      types: pokemon.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name as PokemonTypeName),
      baseStats: extractBaseStats(pokemon),
      levelUpMoves: supportedLevelUp,
      tmMoves: supportedTm,
    });
  }

  if (sparsePool.length > 0) {
    console.warn(
      `[build-dataset] ${sparsePool.length} species have < 4 supported candidate moves: ${sparsePool.slice(0, 20).join(', ')}${sparsePool.length > 20 ? '...' : ''}`
    );
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(`${OUTPUT_DIR}pokemon.json`, JSON.stringify(species), 'utf-8');
  await writeFile(
    `${OUTPUT_DIR}moves.json`,
    JSON.stringify(Object.fromEntries(movesById)),
    'utf-8'
  );

  console.log(`[build-dataset] wrote ${species.length} species and ${movesById.size} moves to ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
