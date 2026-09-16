import { getPokeApi, mapWithConcurrency } from './pokeapi';
import type { ApiPokemonSpecies } from './pokeApiTypes';

/**
 * Fetches /pokemon-species/{id} for a national-dex ID range — the only place
 * PokeAPI carries is_legendary/is_mythical (fetch-pokemon.ts's /pokemon/{id}
 * doesn't). Species ids map 1:1 to the numeric range here, with none of
 * fetch-pokemon.ts's >10000 variety-id concern (Mega/Gmax/regional forms
 * don't get their own species entry).
 */
export async function fetchPokemonSpeciesRange(
  minId: number,
  maxId: number,
  onProgress?: (done: number, total: number) => void
): Promise<ApiPokemonSpecies[]> {
  const ids = Array.from({ length: maxId - minId + 1 }, (_, i) => minId + i);
  const results = await mapWithConcurrency(
    ids,
    async (id) => {
      try {
        return await getPokeApi<ApiPokemonSpecies>(`pokemon-species/${id}`);
      } catch (err) {
        console.warn(`[fetch-pokemon-species] skipping id ${id}: ${(err as Error).message}`);
        return null;
      }
    },
    onProgress
  );
  return results.filter((p): p is ApiPokemonSpecies => p !== null);
}
