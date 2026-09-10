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
  /** When set (via MatchConfig.forcedMoveId — the custom-battle builder's
   * per-move testing pin), ai.ts's chooseMove always returns this exact move
   * id instead of picking randomly among the moveset, even past 0 PP, so a
   * single move's VFX/interaction can be tested repeatedly without ever
   * falling back to Struggle. Also suppresses the opportunistic self-buff
   * pick in engine.ts's maybeAct, so no other move can sneak in mid-chase. */
  forcedMoveId?: number;

  status: StatusCondition | null;
  /** Turn-equivalent counter for sleep/freeze; decremented on the action-cooldown cadence. */
  statusTurnsRemaining?: number;
  /** Independent slow timer (ms) for burn/poison chip damage, decoupled from the movement tick. */
  statusTickAccumMs: number;

  position: Vec2;
  velocity: Vec2;
  facing: FacingDirection;
  /** Half-width (px) of this species' on-screen collision footprint — see
   * COLLISION_RADIUS_FACTOR in constants.ts. Drives both separation steering
   * and the hard positional correction in resolveCollisions(), so bigger
   * Pokémon actually need more clearance than smaller ones. For Boss Mode's
   * boss this is already pre-multiplied by BOSS_CONFIG.spriteScaleMultiplier
   * (see matchSetup.ts) so its hitbox matches its bigger on-screen size. */
  collisionRadius: number;

  /** Alliance for AI targeting (ai.ts/engine.ts never let same-team Pokémon
   * target each other) — physical collision/separation stays team-agnostic.
   * Unique per instance in a normal free-for-all/1v1 match, so it never
   * restricts anything there; Boss Mode's 4 party members all share 'party'
   * while the boss is on its own team, so the party never fights itself. */
  team: string;
  /** True only for Boss Mode's single boss — drives damage amplification
   * (damage.ts) and 3x sprite scale (PokemonSprite.ts). See sim/bossConfig.ts. */
  isBoss?: boolean;

  aiState: AiState;
  targetInstanceId: string | null;
  lastRetargetMs: number;
  wanderWaypoint?: Vec2;
  /** Consecutive ms this Pokémon has spent steering toward wanderWaypoint
   * without making real headway (blocked by a neighbor or a wall) — see
   * WANDER_STUCK_REPICK_MS and movement.ts's trackWanderHeadway(). Unset or
   * 0 whenever it isn't currently walking a wander leg. */
  wanderStuckMs?: number;

  /** Milliseconds remaining before this Pokémon may act (attack) again. */
  actionCooldownMs: number;
  /** Milliseconds remaining in the "hold perfectly still" window after firing
   * a move — see POST_ATTACK_HOLD_MS. Independent of actionCooldownMs, which
   * governs only when it may act *again*, not how long it stays put after
   * acting. */
  postAttackHoldMs: number;

  /** When this Pokémon last fired a move (any executeMove, including a
   * self-buff or a fully-paralyzed whiff). The attack gate (engine.ts's
   * stepActions) hands a free slot to whoever has gone longest without one
   * first, so a low spawn index never gets a standing head start in a
   * crowded arena. Unset until its first move. */
  lastAttackAtMs?: number;

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

/** One attack currently in flight arena-wide — see AttackGateState. */
export interface ActiveAttack {
  attackerId: string;
  /** When its POST_ATTACK_HOLD_MS hold/visual window ends and the slot frees. */
  endsAtMs: number;
}

/** Arena-wide attack pacing bookkeeping (see MAX_SIMULTANEOUS_ATTACKS and
 * friends in constants.ts, and engine.ts's stepActions). Lives on SimState
 * rather than as private engine fields so it's part of the deterministic,
 * inspectable snapshot like every other piece of sim state. */
export interface AttackGateState {
  /** Attacks still inside their hold window, in firing order. Never longer
   * than MAX_SIMULTANEOUS_ATTACKS. */
  active: ActiveAttack[];
  /** No attack may start before this instant — pushed out to
   * completion + ATTACK_GAP_MS every time an in-flight attack finishes. */
  closedUntilMs: number;
  /** Whoever fired the most recent attack. Not allowed to fire the next one
   * while any other living, non-incapacitated Pokémon exists to take it. */
  lastAttackerId: string | null;
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
  /** See AttackGateState. */
  attackGate: AttackGateState;
  /** Purely cosmetic (see MatchConfig.shiny) — echoed here, same as `arena`,
   * so the renderer can read it off the state it already has without a
   * separate plumbing path. The sim itself never branches on this. */
  shiny: boolean;
  /** Echoed from MatchConfig.teams — lets the renderer (RosterPanel,
   * PokemonSprite's team-color ring) know this is a Team Mode match without
   * needing the original MatchConfig. Undefined for free-for-all/Boss Mode. */
  teams?: { size: number };
  /** Echoed from MatchConfig.disableWander — see that field's own comment.
   * Read by ai.ts's updateTargeting, same "echo onto SimState so the reader
   * doesn't need the original MatchConfig" reasoning as `shiny`/`teams`. */
  disableWander?: boolean;
}

export type SimEvent =
  | {
      seq: number;
      atMs: number;
      type: 'moveUsed';
      attackerId: string;
      /** Who this move was actually aimed at (null for a self-targeting move)
       * — captured at the moment the move fired, independent of
       * attacker.targetInstanceId, which sweepFaints() can null out later in
       * this same tick (e.g. a KOing hit clears it once the target's removed
       * from livingOrder). Renderers need the original target to face/aim
       * the attack visual at, not whatever's left of a since-cleared live
       * link. See ArenaScene.ts's enqueueAttack. */
      primaryTargetId: string | null;
      targetIds: string[];
      moveId: number;
      hit: Record<string, boolean>;
      crit: Record<string, boolean>;
      effectiveness: Record<string, number>;
      damage: Record<string, number>;
      /** Attacker/target(s) position at the exact instant this move fired —
       * a fresh {x,y} copy, not a live reference, so later mutation of that
       * Pokémon's actual position object (ordinary movement, or a one-off
       * like completeMatch() teleporting a lone winner to the arena center
       * for its victory pose, both later in this same tick) can never leak
       * back into what's already a historical record of what happened. A
       * render reading attacker.position fresh off live state instead of
       * this would show a match-ending ranged attack's beam/jet originating
       * from the winner's post-teleport center position rather than where
       * they actually stood when they threw it. See ArenaScene.ts's
       * enqueueAttack (and primaryTargetId's own comment for the sibling bug
       * this same reasoning already fixed once, for sweepFaints instead of
       * completeMatch). */
      attackerPosition: Vec2;
      targetPositions: Record<string, Vec2>;
    }
  | { seq: number; atMs: number; type: 'statusApplied'; instanceId: string; status: StatusCondition }
  | { seq: number; atMs: number; type: 'statusTick'; instanceId: string; status: StatusCondition; amount: number }
  | { seq: number; atMs: number; type: 'statusCleared'; instanceId: string; status: StatusCondition }
  | { seq: number; atMs: number; type: 'fainted'; instanceId: string; byInstanceId: string | null }
  | { seq: number; atMs: number; type: 'milestone'; kind: 'matchStart' | 'finalTwo' | 'matchEnd' };

export interface MatchConfig {
  level: 50 | 60 | 70 | 80 | 90 | 100;
  /** Species IDs to draw into the arena; MVP = unique species, no duplicates, length <= 16. */
  speciesIds: number[];
  arena: ArenaBounds;
  /** Whole-roster cosmetic toggle from the setup screen — every Pokémon in
   * the match renders with the shiny recolor/sparkle. No effect on stats,
   * moves, or any other sim behavior. */
  shiny: boolean;
  /** Explicit moveset override, keyed by species ID — up to 4 move IDs drawn
   * from that species' own movePool (see data/loader.ts's
   * buildSpeciesDataForLevel), used by the custom-battle builder so a player
   * can hand-pick exactly which moves a Pokémon brings in instead of the
   * sim's default random 4. A species with no entry here (or an entry with
   * moves outside its real movePool) falls back to the random pick — see
   * matchSetup.ts's pickMoveSlots. */
  customMoves?: Record<number, number[]>;
  /** Pins one exact move (by ID) a species always uses on its turn instead of
   * ai.ts's normal random pick among its equipped moveset, keyed by species
   * ID — same "custom-battle builder" origin and keying convention as
   * `customMoves` above, for testing one specific move's VFX/interaction
   * repeatedly without the bot cycling through its other moves. See
   * PokemonInstance.forcedMoveId (matchSetup.ts wires this onto the instance
   * at build time) and ai.ts's chooseMove. A species with no entry here (or
   * whose entry isn't actually in its resolved moveset) uses the normal
   * random pick. */
  forcedMoveId?: Record<number, number>;
  /** Custom-battle testing toggle: suppresses idle wandering (the cold-open
   * grace period and the between-attacks wander-off) so combatants close in
   * and stay in range of each other instead — see ai.ts's updateTargeting
   * and NO_WANDER_AGGRO_RADIUS. Meant to be paired with a small `arena` for
   * fast VFX/move-interaction testing; has no effect on damage, targeting
   * priority, or any other sim rule. Echoed onto SimState.disableWander. */
  disableWander?: boolean;
  /** When present, this is a Boss Mode match: `speciesIds` become the 4-Pokémon
   * party (allies, sharing one team), and this additional species enters as a
   * heavily-amplified boss on its own team — see sim/bossConfig.ts and
   * matchSetup.ts. */
  boss?: { speciesId: number };
  /** When present, this is a Team Mode match: `speciesIds` is split into two
   * equal-sized opposing sides — the first `teams.size` entries are Team A,
   * the rest are Team B (so `speciesIds.length` must equal `teams.size * 2`) —
   * each side shares one team id and never targets its own teammates, only
   * the other side. Mutually exclusive with `boss` (Boss Mode already has its
   * own party/boss team split). See matchSetup.ts. */
  teams?: { size: number };
}
