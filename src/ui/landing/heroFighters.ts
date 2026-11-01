import { pmdSheetUrl } from '../../render/sprites/pmdSheetUrl';

/** The hero court's four fighters, drawn from their PMD Idle sheets. The
 * frame sizes are copied out of public/pmd-sprite-index.json (re-copy if a
 * sheet is updated) so the landing page never fetches that 1.4 MB index. */
export interface HeroFighter {
  id: number;
  name: string;
  team: 'ruby' | 'sapphire';
  dir: string;
  version: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  loopMs: number;
  /** Sheet row: 2 faces right (east), 6 faces left (west). */
  row: number;
  /** Placement class from landingCss. */
  slot: string;
  hideOnMobile?: boolean;
  shielded?: boolean;
}

export const HERO_FIGHTERS: readonly HeroFighter[] = [
  {
    id: 4,
    name: 'Charmander',
    team: 'ruby',
    dir: '0004',
    version: 'tl2aa9',
    frameWidth: 32,
    frameHeight: 40,
    frames: 4,
    loopMs: 599,
    row: 2,
    slot: 'lp-hero-t1',
  },
  {
    id: 25,
    name: 'Pikachu',
    team: 'ruby',
    dir: '0025',
    version: 'tl2aa9',
    frameWidth: 40,
    frameHeight: 56,
    frames: 6,
    loopMs: 883,
    row: 2,
    slot: 'lp-hero-t2',
  },
  {
    id: 7,
    name: 'Squirtle',
    team: 'sapphire',
    dir: '0007',
    version: 'tl2aa9',
    frameWidth: 32,
    frameHeight: 32,
    frames: 8,
    loopMs: 833,
    row: 6,
    slot: 'lp-hero-t3',
    shielded: true,
  },
  {
    id: 1,
    name: 'Bulbasaur',
    team: 'sapphire',
    dir: '0001',
    version: 'tl2aa9',
    frameWidth: 32,
    frameHeight: 40,
    frames: 3,
    loopMs: 867,
    row: 6,
    slot: 'lp-hero-t4',
    hideOnMobile: true,
    shielded: true,
  },
];

/** One CSS rule + keyframes per fighter: the sheet as a background, stepped across its frames. */
export const HERO_FIGHTER_CSS = HERO_FIGHTERS.map(
  (
    f
  ) => `.lp-sprite-${f.id}{width:${f.frameWidth}px;height:${f.frameHeight}px;background:url("${pmdSheetUrl(f.dir, 'Idle', f.version)}") 0 -${f.row * f.frameHeight}px no-repeat;animation:lp-idle-${f.id} ${f.loopMs}ms steps(${f.frames}) infinite}
@keyframes lp-idle-${f.id}{to{background-position-x:-${f.frames * f.frameWidth}px}}`
).join('\n');
