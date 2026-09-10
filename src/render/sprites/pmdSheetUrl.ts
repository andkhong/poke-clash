import indexVersionData from '../../data/generated/pmdSpriteIndexVersion.json';

/**
 * Cache tag for the PMD sprite sheets. In production Caddy serves
 * /pmd-sprites/* with a year-long immutable Cache-Control (see Caddyfile),
 * which is only safe because the URL changes whenever the sheets do. Two
 * tags cover that:
 *
 * - PMD_SHEET_VERSION, here, for anything that changes every sheet at
 *   once (a change to the optimizer's output, a re-fetch of the whole
 *   mirror). Re-optimizing to byte-identical pixels doesn't need a bump.
 * - the per-species `version` in the index (see
 *   data-pipeline/pmdSpriteIndexFiles.ts), stamped from when that species
 *   was fetched, so an upstream update that replaces one species' sheets
 *   (data-pipeline/check-pmd-sprite-updates.ts) changes only that
 *   species' URLs.
 *
 * History: 1 = the raw PMDCollab sheets; 2 = the palette-encoded sheets
 * from data-pipeline/optimize-pmd-sprites.ts (same pixels, so the bump is
 * belt-and-braces).
 */
export const PMD_SHEET_VERSION = 2;

/** Digest of public/pmd-sprite-index.json, regenerated with it. */
const PMD_SPRITE_INDEX_VERSION = (indexVersionData as { version: string }).version;

export function pmdSheetUrl(dir: string, action: string, speciesVersion?: string): string {
  return `/pmd-sprites/${dir}/${action}-Anim.png?v=${PMD_SHEET_VERSION}${speciesVersion ? `-${speciesVersion}` : ''}`;
}

/** The per-species frame metadata for those sheets (public/pmd-sprite-index.json,
 * fetched by ArenaScene's preload rather than bundled — see
 * data-pipeline/pmdSpriteIndexFiles.ts). Tagged with the sheet version and
 * its own digest, so a regenerated index (a species added or updated) is
 * fetched fresh instead of served from the year-long cache. */
export function pmdSpriteIndexUrl(): string {
  return `/pmd-sprite-index.json?v=${PMD_SHEET_VERSION}-${PMD_SPRITE_INDEX_VERSION}`;
}
