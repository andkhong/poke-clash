import { hasPmdSprite, listAllSpecies } from '../data/loader';

// Setup screen roster presets. Kept out of app/config.ts because resolving
// them needs the species dataset, and config.ts is imported by the landing
// page, which shouldn't have to load that dataset just to paint.

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
