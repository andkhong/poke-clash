import pmdBodySizes from './generated/pmdBodySizes.json';

// Native visible-body size of each species' PMD sprite — [width, height] in
// sheet pixels, the bounding box of its non-transparent pixels across every
// Idle and Walk frame in every facing. Written by
// data-pipeline/measure-pmd-bodies.ts (re-run whenever the sprite mirror
// changes; check-pmd-sprite-updates.ts --apply does). Bundled (~13 KB)
// rather than read off the sheets at runtime because the sim needs it
// before any sheet loads, on the game server too: a Pokémon's
// collisionRadius is derived from it (loader.ts), and the renderer scales
// the sheet by the same number so the hitbox matches what's drawn
// (PokemonSprite.ts, computeOnScreenSizeFromBody in sim/constants.ts).
const BODY_SIZES = pmdBodySizes as unknown as Record<string, [width: number, height: number]>;

/** Longest side of the species' visible PMD body in native sheet pixels, or
 * undefined for a species with no measured PMD sprite. */
export function getPmdBodySize(speciesId: number): number | undefined {
  const size = BODY_SIZES[String(speciesId)];
  return size ? Math.max(size[0], size[1]) : undefined;
}
