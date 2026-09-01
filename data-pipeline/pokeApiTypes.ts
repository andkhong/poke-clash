// Minimal shape of the PokeAPI resources we actually read. Not exhaustive —
// PokeAPI returns much more than this per resource.

export interface NamedApiResource {
  name: string;
  url: string;
}

export interface ApiPokemonStat {
  base_stat: number;
  stat: NamedApiResource;
}

export interface ApiPokemonType {
  slot: number;
  type: NamedApiResource;
}

export interface ApiVersionGroupDetail {
  level_learned_at: number;
  move_learn_method: NamedApiResource; // e.g. 'level-up' | 'machine' | 'egg' | 'tutor'
  version_group: NamedApiResource; // e.g. 'scarlet-violet'
}

export interface ApiPokemonMove {
  move: NamedApiResource;
  version_group_details: ApiVersionGroupDetail[];
}

export interface ApiPokemon {
  id: number;
  /** The "variety" name — carries a form suffix even for the default variety of
   * some species (e.g. "deoxys-normal"). Use `species.name` for display/slug
   * purposes instead; it's always the bare species name ("deoxys"). */
  name: string;
  is_default: boolean;
  species: NamedApiResource;
  stats: ApiPokemonStat[];
  types: ApiPokemonType[];
  moves: ApiPokemonMove[];
}

export interface ApiMoveStatChange {
  change: number;
  stat: NamedApiResource; // e.g. 'attack', 'accuracy', 'evasion'
}

export interface ApiMoveMeta {
  ailment: NamedApiResource; // e.g. 'paralysis', 'none'
  ailment_chance: number;
  category: NamedApiResource; // e.g. 'damage', 'ailment', 'net-good-stats', 'damage+ailment', ...
  crit_rate: number;
  drain: number;
  flinch_chance: number;
  healing: number;
  max_hits: number | null;
  max_turns: number | null;
  min_hits: number | null;
  min_turns: number | null;
  stat_chance: number;
}

export interface ApiMove {
  id: number;
  name: string;
  accuracy: number | null;
  power: number | null;
  pp: number;
  priority: number;
  damage_class: NamedApiResource; // 'physical' | 'special' | 'status'
  type: NamedApiResource;
  target: NamedApiResource; // e.g. 'selected-pokemon', 'user', 'all-other-pokemon', ...
  meta: ApiMoveMeta | null;
  stat_changes: ApiMoveStatChange[];
}
