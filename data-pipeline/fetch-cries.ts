import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mapWithConcurrency } from './pokeapi';

// Played when a Pokémon's Pokéball pops open (PokemonSprite's entrance
// reveal). Downloaded (not hotlinked) into public/ so they're served as
// static files with zero runtime dependency on a third-party CDN — the same
// reliability lesson learned from the Showdown sprite flakiness earlier in
// this project. Source: PokeAPI/cries, the same community org as
// PokeAPI/sprites already used throughout this project's data pipeline.
const POKEMON_JSON_PATH = new URL('../src/data/generated/pokemon.json', import.meta.url).pathname;
const OUTPUT_DIR = new URL('../public/cries/', import.meta.url).pathname;
const CRY_URL = (id: number) => `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${id}.ogg`;

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const species = JSON.parse(await readFile(POKEMON_JSON_PATH, 'utf-8')) as { id: number; name: string }[];
  await mkdir(OUTPUT_DIR, { recursive: true });

  const todo: number[] = [];
  for (const s of species) {
    if (!(await fileExists(`${OUTPUT_DIR}${s.id}.ogg`))) todo.push(s.id);
  }
  console.log(`[fetch-cries] ${species.length} species, ${todo.length} not yet downloaded`);

  let done = 0;
  let failed = 0;
  await mapWithConcurrency(todo, async (id) => {
    try {
      const res = await fetch(CRY_URL(id));
      if (!res.ok) {
        failed += 1;
        console.warn(`[fetch-cries] ${id}: HTTP ${res.status}`);
        return;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await writeFile(`${OUTPUT_DIR}${id}.ogg`, buffer);
    } catch (err) {
      failed += 1;
      console.warn(`[fetch-cries] ${id}: ${(err as Error).message}`);
    } finally {
      done += 1;
      if (done % 100 === 0 || done === todo.length) {
        console.log(`[fetch-cries] ${done}/${todo.length}`);
      }
    }
  });

  console.log(`[fetch-cries] done. ${todo.length - failed}/${todo.length} downloaded this run, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
