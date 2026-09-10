import { hasPmdSprite, listAllSpecies } from '../data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH } from '../sim/constants';
import type { ArenaBounds } from '../sim/types';

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
export { ARENA_WIDTH, ARENA_HEIGHT, DESKTOP_ARENA_WIDTH, DESKTOP_ARENA_HEIGHT };

/**
 * True for an actual mobile device (phone/tablet), never for a desktop
 * browser window regardless of how it's sized or shaped — this is a device
 * check, not a viewport-orientation one, so a phone rotated to landscape (or
 * a desktop window resized narrow-tall) doesn't flip the answer. Computed
 * once at module load since a session's device type never changes.
 *
 * Prefers the Client Hints `navigator.userAgentData.mobile` flag (accurate,
 * but Chromium-only today) and falls back to a standard UA regex elsewhere
 * (Safari/Firefox). Guarded for a non-browser context (e.g. this module
 * loaded under a test runner with no `navigator`) even though nothing
 * currently imports app/config.ts from one.
 */
export const IS_MOBILE_DEVICE: boolean = detectMobileDevice();

function detectMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (typeof nav.userAgentData?.mobile === 'boolean') return nav.userAgentData.mobile;
  return /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(navigator.userAgent);
}

/**
 * Resolves this match's arena shape. Mobile devices are hard-locked to the
 * portrait arena this game is fundamentally built around (it's meant to
 * become IG/TikTok video, see sim/constants.ts's ARENA_WIDTH/HEIGHT comment)
 * — `preferWide` is ignored entirely on one, since a phone user is never
 * even shown the option (see useWideArenaPreference). A non-mobile browser
 * defaults to the same portrait arena too, but can opt into the wider
 * desktop one via that preference. Decided once, at match start, the same
 * way arena size is already fixed for a match's whole duration — resizing
 * the window mid-match doesn't reshape an arena already in progress.
 */
export function resolveMatchArena(preferWide: boolean): ArenaBounds {
  if (!IS_MOBILE_DEVICE && preferWide) return { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };
  return { width: ARENA_WIDTH, height: ARENA_HEIGHT };
}

export interface ArenaSizeOption {
  id: 'standard' | 'small' | 'tiny';
  label: string;
  width: number;
  height: number;
}

/** Custom 1v1's map-size picker — scaled down from whichever base arena is
 * actually active (see resolveMatchArena) at the same aspect ratio (rather
 * than an unrelated shape), so the background tileset/camera framing still
 * reads correctly at every size. Smaller means a shorter spawn-to-spawn
 * distance (see matchSetup.ts's circlePosition, which sizes the spawn circle
 * off Math.min(width, height)), so combatants close into attack range faster
 * — the point of offering this at all is fast VFX/move-interaction testing
 * (see CustomBattleScreen's "Disable Wander" toggle, MatchConfig.disableWander,
 * for the complementary "stop wandering once in range" half of that). 'tiny'
 * is the practical floor: any smaller and ARENA_TOP_PADDING's fixed HUD
 * reservation (sim/constants.ts) would start crowding out the playable area. */
export function buildArenaSizeOptions(base: ArenaBounds): ArenaSizeOption[] {
  return [
    { id: 'standard', label: 'Standard', width: base.width, height: base.height },
    { id: 'small', label: 'Small', width: Math.round(base.width * 0.7), height: Math.round(base.height * 0.7) },
    { id: 'tiny', label: 'Tiny', width: Math.round(base.width * 0.45), height: Math.round(base.height * 0.45) },
  ];
}
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
