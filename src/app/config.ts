import { hasPmdSprite, listAllSpecies } from '../data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';

export const LEVEL_OPTIONS = [50, 60, 70, 80, 90, 100] as const;
export type SelectableLevel = (typeof LEVEL_OPTIONS)[number];

export const MIN_ROSTER_SIZE = 2;
export const MAX_ROSTER_SIZE = 16;
export const DEFAULT_ROSTER_SIZE = 16;

/** Per-side sizes Team Mode offers (2v2/3v3/4v4/8v8) — each doubles to the
 * match's total roster size, capped by MAX_ROSTER_SIZE (8v8 = 16). */
export const TEAM_SIZE_OPTIONS = [2, 3, 4, 8] as const;
export type TeamSize = (typeof TEAM_SIZE_OPTIONS)[number];

// Single source of truth is sim/constants.ts — re-exported here so UI code
// only ever needs to import from app/config.
export { ARENA_WIDTH, ARENA_HEIGHT };

export interface ArenaSizeOption {
  id: 'standard' | 'small' | 'tiny';
  label: string;
  width: number;
  height: number;
}

/** Custom 1v1's map-size picker — scaled down from the default arena at the
 * same aspect ratio (rather than an unrelated shape), so the background
 * tileset/camera framing still reads correctly at every size. Smaller means
 * a shorter spawn-to-spawn distance (see matchSetup.ts's circlePosition,
 * which sizes the spawn circle off Math.min(width, height)), so combatants
 * close into attack range faster — the point of offering this at all is
 * fast VFX/move-interaction testing (see CustomBattleScreen's "Disable
 * Wander" toggle, MatchConfig.disableWander, for the complementary "stop
 * wandering once in range" half of that). 'tiny' is the practical floor:
 * any smaller and ARENA_TOP_PADDING's fixed HUD reservation (sim/constants.ts)
 * would start crowding out the playable area. */
export const ARENA_SIZE_OPTIONS: ArenaSizeOption[] = [
  { id: 'standard', label: 'Standard', width: ARENA_WIDTH, height: ARENA_HEIGHT },
  { id: 'small', label: 'Small', width: Math.round(ARENA_WIDTH * 0.7), height: Math.round(ARENA_HEIGHT * 0.7) },
  { id: 'tiny', label: 'Tiny', width: Math.round(ARENA_WIDTH * 0.45), height: Math.round(ARENA_HEIGHT * 0.45) },
];
export type ArenaSizeId = ArenaSizeOption['id'];

interface ThemePreset {
  id: string;
  label: string;
  description: string;
  speciesNames: string[];
}

// Echoes the three example videos' rosters. Resolved to species IDs lazily
// (not at module load) so a name typo fails loudly in listAllSpecies() lookup
// rather than silently, and so this stays a plain data table.
const THEME_PRESETS_RAW: ThemePreset[] = [
  {
    id: 'kanto-favorites',
    label: 'Kanto Favorites',
    description: 'Pikachu, Snorlax, Charizard, Blastoise, Venusaur, Lapras',
    speciesNames: ['pikachu', 'snorlax', 'charizard', 'blastoise', 'venusaur', 'lapras'],
  },
  {
    id: 'legendaries',
    label: 'Legendaries',
    description: 'The box legends and beasts across generations',
    speciesNames: [
      'ho-oh', 'lugia', 'suicune', 'entei', 'raikou',
      'groudon', 'kyogre', 'rayquaza',
      'dialga', 'palkia', 'giratina',
      'reshiram', 'zekrom', 'kyurem',
      'xerneas', 'yveltal',
    ],
  },
  {
    id: 'starters',
    label: 'Starters',
    description: 'Fully-evolved starters spanning many generations',
    speciesNames: [
      'venusaur', 'charizard', 'blastoise',
      'meganium', 'typhlosion', 'feraligatr',
      'sceptile', 'blaziken', 'swampert',
      'torterra', 'infernape', 'empoleon',
      'serperior', 'emboar', 'samurott',
      'greninja',
    ],
  },
];

export interface ResolvedThemePreset {
  id: string;
  label: string;
  description: string;
  speciesIds: number[];
}

export function getThemePresets(): ResolvedThemePreset[] {
  const byName = new Map(listAllSpecies().map((s) => [s.name, s.id]));
  return THEME_PRESETS_RAW.map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    // Species without a real PMD sprite are excluded here too — see
    // hasPmdSprite() — so a preset never quietly includes the older
    // hotlink-art fallback.
    speciesIds: preset.speciesNames
      .map((n) => byName.get(n))
      .filter((id): id is number => id !== undefined && hasPmdSprite(id)),
  }));
}
