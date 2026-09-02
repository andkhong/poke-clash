import { listAllSpecies } from '../data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../sim/constants';

export const LEVEL_OPTIONS = [50, 60, 70, 80, 90, 100] as const;
export type SelectableLevel = (typeof LEVEL_OPTIONS)[number];

export const MIN_ROSTER_SIZE = 2;
export const MAX_ROSTER_SIZE = 16;
export const DEFAULT_ROSTER_SIZE = 16;

// Single source of truth is sim/constants.ts — re-exported here so UI code
// only ever needs to import from app/config.
export { ARENA_WIDTH, ARENA_HEIGHT };

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
    speciesIds: preset.speciesNames.map((n) => byName.get(n)).filter((id): id is number => id !== undefined),
  }));
}
