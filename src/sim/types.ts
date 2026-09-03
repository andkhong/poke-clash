// Core simulation types. This module (and everything else in src/sim/) is pure
// TypeScript: no Phaser, no React, no DOM. The engine is deterministic given a
// seed and produces a state snapshot + an append-only event log; renderers are
// just readers.

export type PokemonTypeName =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice' | 'fighting' | 'poison'
  | 'ground' | 'flying' | 'psychic' | 'bug' | 'rock' | 'ghost' | 'dragon' | 'dark'
  | 'steel' | 'fairy';

export interface StatBlock {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export type StatKey = keyof StatBlock;

/** The 5 battle-stat stages (-6..+6) plus accuracy/evasion, which use a different curve. */
export type StageKey = Exclude<StatKey, 'hp'> | 'accuracy' | 'evasion';

export type StatusCondition = 'sleep' | 'paralysis' | 'burn' | 'poison' | 'freeze';

export type MoveCategory = 'physical' | 'special' | 'status';

export type MoveTargeting = 'enemy' | 'self' | 'all-enemies-in-radius';

// Only the two effect kinds the data pipeline actually classifies moves into
// (see data-pipeline/classify-move-effects.ts) — everything else (drain, recoil,
// flinch-only, weather, hazards, multi-turn, ...) is out of scope for v1 and such
// moves are either treated as damage-only or excluded from the learnable pool.
export interface MoveEffect {
  kind: 'statusInflict' | 'statStage';
  /** For kind === 'statusInflict' */
  status?: StatusCondition;
  /** For kind === 'statStage'. Positive = boost, negative = drop. */
  statChanges?: Partial<Record<StageKey, number>>;
  /** Who the effect applies to — the move's own target resolution, not necessarily the same as damage target. */
  target?: 'self' | 'enemy';
  /** 0-100. Undefined means "always" (100), used for the move's listed secondary/primary effect. */
  chance?: number;
}

export interface MoveDefinition {
  id: number;
  name: string;
  type: PokemonTypeName;
  category: MoveCategory;
  power: number | null;
  accuracy: number | null; // null = never misses (e.g. Swift-likes), handled as always-hit
  pp: number;
  priority: number;
  targeting: MoveTargeting;
  effect?: MoveEffect;
  highCrit?: boolean; // moves like Slash get an elevated crit stage
  /** Struggle only: bypasses the type chart and STAB entirely (real in-game rule). */
  typeless?: boolean;
}

export interface MoveSlot {
  moveId: number;
  ppRemaining: number;
  ppMax: number;
}

export type AiState = 'wander' | 'chase' | 'attack' | 'incapacitated' | 'fainted';

export type FacingDirection = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PokemonInstance {
  instanceId: string;
  speciesId: number;
  name: string;
  level: number;
  types: PokemonTypeName[];

  baseStats: StatBlock;
  /** base+level+IV31+EV0+neutral-nature, pre-stat-stage */
  computedStats: StatBlock;
  statStages: Record<StageKey, number>;

  currentHp: number;
  maxHp: number;

  moves: MoveSlot[];

  status: StatusCondition | null;
  /** Turn-equivalent counter for sleep/freeze; decremented on the action-cooldown cadence. */
  statusTurnsRemaining?: number;
  /** Independent slow timer (ms) for burn/poison chip damage, decoupled from the movement tick. */
  statusTickAccumMs: number;

  position: Vec2;
  velocity: Vec2;
  facing: FacingDirection;

  aiState: AiState;
  targetInstanceId: string | null;
  lastRetargetMs: number;
  wanderWaypoint?: Vec2;

  /** Milliseconds remaining before this Pokémon may act (attack) again. */
  actionCooldownMs: number;

  /** Set the tick a hit lands, so renderers can play a one-shot flash/shake and clear it themselves. */
  lastHitAtMs?: number;
  /** Last Pokémon to land damaging hit on this one — feeds the "X > Y" elimination log on faint. */
  lastDamagedByInstanceId?: string;
}

export type MatchPhase = 'intro' | 'battle' | 'finalTwo' | 'complete';

export interface ArenaBounds {
  width: number;
  height: number;
}

export interface SimState {
  tick: number;
  elapsedMs: number;
  pokemon: Record<string, PokemonInstance>;
  /** Every instance ID in original spawn order, fixed for the whole match — the
   * HUD roster panel iterates this (not livingOrder) so a fainted Pokémon's row
   * stays put and just empties out, instead of disappearing. */
  allInstanceIds: string[];
  /** Living instance IDs in stable (spawn) order — a shrinking subset of allInstanceIds. */
  livingOrder: string[];
  /** Fainted instance IDs in the order they fainted — used for the elimination log. */
  eliminationOrder: string[];
  phase: MatchPhase;
  /** Empty until phase === 'complete'. More than one entry means the 90s hard
   * time limit was hit with multiple Pokémon still standing — they're
   * declared co-winners rather than forcing a single victor. */
  winnerInstanceIds: string[];
  arena: ArenaBounds;
  /** Computed from roster size — see constants.ts computeIntroDurationMs. */
  introDurationMs: number;
}

export type SimEvent =
  | {
      seq: number;
      atMs: number;
      type: 'moveUsed';
      attackerId: string;
      targetIds: string[];
      moveId: number;
      hit: Record<string, boolean>;
      crit: Record<string, boolean>;
      effectiveness: Record<string, number>;
      damage: Record<string, number>;
    }
  | { seq: number; atMs: number; type: 'statusApplied'; instanceId: string; status: StatusCondition }
  | { seq: number; atMs: number; type: 'statusTick'; instanceId: string; status: StatusCondition; amount: number }
  | { seq: number; atMs: number; type: 'statCleared'; instanceId: string; status: StatusCondition }
  | { seq: number; atMs: number; type: 'fainted'; instanceId: string; byInstanceId: string | null }
  | { seq: number; atMs: number; type: 'milestone'; kind: 'matchStart' | 'finalTwo' | 'matchEnd' };

export interface MatchConfig {
  level: 50 | 60 | 70 | 80 | 90 | 100;
  /** Species IDs to draw into the arena; MVP = unique species, no duplicates, length <= 16. */
  speciesIds: number[];
  arena: ArenaBounds;
}
