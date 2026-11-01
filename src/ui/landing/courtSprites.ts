import idleSprites from '../../data/generated/kantoIdleSprites.json';
import { pmdSheetUrl } from '../../render/sprites/pmdSheetUrl';

// The landing page's court pictures draw real Pokémon from their PMD Idle
// sheets, stepped across the frames in CSS. The frame sizes come from the
// small generated Kanto table (data-pipeline/pmdSpriteIndexFiles.ts), never
// from the 1.4 MB index the arena loads.

/** [sheet dir, version, frame width, frame height, frame count, loop ms]. */
type IdleEntry = [string, string, number, number, number, number];
const IDLE = idleSprites as unknown as Record<string, IdleEntry>;

/** Sheet rows: PMD sheets hold one row per facing. */
export const FACE_DOWN = 0;
export const FACE_RIGHT = 2;
export const FACE_LEFT = 6;

export function hasIdleSprite(id: number): boolean {
  return id in IDLE;
}

export function idleSpriteClass(id: number, row: number): string {
  return `lp-sprite lp-sprite-${id}-${row}`;
}

/** CSS for each (species, facing) pair — the sheet as a background, stepped across its frames. */
export function idleSpritesCss(sprites: readonly { id: number; row: number }[]): string {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const { id, row } of sprites) {
    const entry = IDLE[id];
    const key = `${id}-${row}`;
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    const [dir, version, w, h, frames, loopMs] = entry;
    rules.push(
      `.lp-sprite-${key}{width:${w}px;height:${h}px;background:url("${pmdSheetUrl(dir, 'Idle', version)}") 0 -${row * h}px no-repeat;animation:lp-idle-${key} ${loopMs}ms steps(${frames}) infinite}`,
      `@keyframes lp-idle-${key}{to{background-position-x:-${frames * w}px}}`
    );
  }
  return rules.join('\n');
}

/** The hero court: Charmander and Pikachu (Ruby) face Squirtle and Bulbasaur (Sapphire). */
export const HERO_FIGHTERS: readonly {
  id: number;
  team: 'ruby' | 'sapphire';
  row: number;
  /** Placement class from landingCss. */
  slot: string;
  hideOnMobile?: boolean;
  shielded?: boolean;
}[] = [
  { id: 4, team: 'ruby', row: FACE_RIGHT, slot: 'lp-hero-t1' },
  { id: 25, team: 'ruby', row: FACE_RIGHT, slot: 'lp-hero-t2' },
  { id: 7, team: 'sapphire', row: FACE_LEFT, slot: 'lp-hero-t3', shielded: true },
  { id: 1, team: 'sapphire', row: FACE_LEFT, slot: 'lp-hero-t4', hideOnMobile: true, shielded: true },
];

export const HERO_FIGHTER_CSS = idleSpritesCss(HERO_FIGHTERS);
