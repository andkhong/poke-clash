import { getPokeApi, mapWithConcurrency } from './pokeapi';
import type { ApiMove } from './pokeApiTypes';

export async function fetchMoves(
  moveIds: readonly number[],
  onProgress?: (done: number, total: number) => void
): Promise<ApiMove[]> {
  const results = await mapWithConcurrency(
    moveIds,
    async (id) => {
      try {
        return await getPokeApi<ApiMove>(`move/${id}`);
      } catch (err) {
        console.warn(`[fetch-moves] skipping id ${id}: ${(err as Error).message}`);
        return null;
      }
    },
    onProgress
  );
  return results.filter((m): m is ApiMove => m !== null);
}
