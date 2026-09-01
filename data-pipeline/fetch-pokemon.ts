import { getPokeApi, mapWithConcurrency } from './pokeapi';
import type { ApiPokemon } from './pokeApiTypes';

/**
 * Fetches /pokemon/{id} for a national-dex ID range. Querying by numeric ID
 * (rather than the /pokemon list endpoint) naturally returns each species'
 * default/base form — Mega Evolutions, Gigantamax, and regional variants live
 * at separate non-numeric-friendly IDs (>10000) and are simply never requested,
 * which is exactly the MVP "base forms only" scope.
 */
export async function fetchPokemonRange(
  minId: number,
  maxId: number,
  onProgress?: (done: number, total: number) => void
): Promise<ApiPokemon[]> {
  const ids = Array.from({ length: maxId - minId + 1 }, (_, i) => minId + i);
  const results = await mapWithConcurrency(
    ids,
    async (id) => {
      try {
        return await getPokeApi<ApiPokemon>(`pokemon/${id}`);
      } catch (err) {
        console.warn(`[fetch-pokemon] skipping id ${id}: ${(err as Error).message}`);
        return null;
      }
    },
    onProgress
  );
  return results.filter((p): p is ApiPokemon => p !== null);
}
