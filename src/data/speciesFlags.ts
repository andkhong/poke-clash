import legendaryOrMythicalIds from './generated/legendaryOrMythicalIds.json';

// Species PokeAPI flags is_legendary or is_mythical (see
// data-pipeline/build-dataset.ts / fetch-pokemon-species.ts). Used to
// restrict the Legendary Arena showcase room's random-fill pool
// (game-server/server.ts) — nothing else reads this.
const LEGENDARY_OR_MYTHICAL = new Set<number>(legendaryOrMythicalIds as number[]);

export function isLegendaryOrMythical(speciesId: number): boolean {
  return LEGENDARY_OR_MYTHICAL.has(speciesId);
}

export function legendaryOrMythicalSpeciesIds(): number[] {
  return [...LEGENDARY_OR_MYTHICAL];
}
