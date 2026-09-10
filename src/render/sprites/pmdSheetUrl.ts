/**
 * Cache tag for the PMD sprite sheets. In production Caddy serves
 * /pmd-sprites/* with a year-long immutable Cache-Control (see Caddyfile),
 * which is only safe because the URL changes whenever the sheets do: bump
 * this whenever the mirror on the volume is replaced with sheets whose
 * pixels or frame layout differ from the previous upload (a re-fetch from
 * PMDCollab, a change to the optimizer's output — anything that also
 * changes pmdSpriteIndex.json's frame metadata certainly qualifies).
 * Re-optimizing to byte-identical pixels doesn't need a bump.
 *
 * History: 1 = the raw PMDCollab sheets; 2 = the palette-encoded sheets
 * from data-pipeline/optimize-pmd-sprites.ts (same pixels, so the bump is
 * belt-and-braces).
 */
export const PMD_SHEET_VERSION = 2;

export function pmdSheetUrl(dir: string, action: string): string {
  return `/pmd-sprites/${dir}/${action}-Anim.png?v=${PMD_SHEET_VERSION}`;
}
