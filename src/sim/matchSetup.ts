import type {
  ArenaBounds,
  MatchConfig,
  MoveDefinition,
  MoveSlot,
  PokemonInstance,
  PokemonTypeName,
  SimState,
  StatBlock,
  Vec2,
} from './types';
import type { Rng } from './rng';
import { rngShuffle } from './rng';
import { computeStats, createNeutralStages } from './statCalc';
import { computeIntroDurationMs } from './constants';
import { BOSS_CONFIG } from './bossConfig';

export interface SpeciesData {
  id: number;
  name: string;
  types: PokemonTypeName[];
  baseStats: StatBlock;
  /** Candidate move-ID pool this species can draw its random 4 from (see data-pipeline). */
  movePool: number[];
  /** See PokemonInstance.collisionRadius. Computed from the species' actual
   * on-screen sprite size (data/loader.ts) so it stays in sync with what's
   * rendered, without the sim needing to know anything about sprites. */
  collisionRadius: number;
}

export type MoveLookup = (moveId: number) => MoveDefinition | undefined;

/** `explicit` (from MatchConfig.customMoves) takes priority when it names at
 * least one move actually in this species' pool — letting the custom-battle
 * builder pin an exact moveset — otherwise falls back to today's random 4. */
function pickMoveSlots(pool: readonly number[], moves: MoveLookup, rng: Rng, explicit?: readonly number[]): MoveSlot[] {
  const validExplicit = explicit?.filter((id) => pool.includes(id));
  const source = validExplicit && validExplicit.length > 0 ? validExplicit : rngShuffle(rng, pool);
  const slots: MoveSlot[] = [];
  for (const moveId of source) {
    if (slots.length >= 4) break;
    const def = moves(moveId);
    if (!def) continue;
    slots.push({ moveId, ppRemaining: def.pp, ppMax: def.pp });
  }
  return slots;
}

function circlePosition(index: number, count: number, arena: ArenaBounds): Vec2 {
  const centerX = arena.width / 2;
  const centerY = arena.height / 2;
  const radius = Math.min(arena.width, arena.height) * 0.32;
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
  };
}

function arenaCenter(arena: ArenaBounds): Vec2 {
  return { x: arena.width / 2, y: arena.height / 2 };
}

function scaleBaseStats(base: StatBlock, multiplier: number): StatBlock {
  return {
    hp: base.hp * multiplier,
    atk: base.atk * multiplier,
    def: base.def * multiplier,
    spa: base.spa * multiplier,
    spd: base.spd * multiplier,
    spe: base.spe * multiplier,
  };
}

function buildInstance(
  speciesId: number,
  instanceId: string,
  team: string,
  position: Vec2,
  species: Record<number, SpeciesData>,
  moves: MoveLookup,
  rng: Rng,
  level: number,
  customMoves: Record<number, number[]> | undefined,
  isBoss: boolean
): PokemonInstance {
  const data = species[speciesId];
  if (!data) throw new Error(`Unknown species id ${speciesId} in match config`);

  const baseStats = isBoss ? scaleBaseStats(data.baseStats, BOSS_CONFIG.baseStatMultiplier) : data.baseStats;
  const computedStats = computeStats(baseStats, level);
  if (isBoss) computedStats.hp = Math.floor(computedStats.hp * BOSS_CONFIG.healthMultiplier);

  return {
    instanceId,
    speciesId,
    name: data.name,
    level,
    types: data.types,
    baseStats,
    computedStats,
    statStages: createNeutralStages(),
    currentHp: computedStats.hp,
    maxHp: computedStats.hp,
    moves: pickMoveSlots(data.movePool, moves, rng, customMoves?.[speciesId]),
    status: null,
    statusTickAccumMs: 0,
    position,
    velocity: { x: 0, y: 0 },
    facing: 'S',
    collisionRadius: isBoss ? data.collisionRadius * BOSS_CONFIG.spriteScaleMultiplier : data.collisionRadius,
    team,
    isBoss,
    aiState: 'wander',
    targetInstanceId: null,
    lastRetargetMs: 0,
    actionCooldownMs: 0,
    postAttackHoldMs: 0,
    wanderWaypoint: undefined,
  };
}

export function createMatch(
  config: MatchConfig,
  species: Record<number, SpeciesData>,
  moves: MoveLookup,
  rng: Rng
): SimState {
  const pokemon: Record<string, PokemonInstance> = {};
  const livingOrder: string[] = [];
  const count = config.speciesIds.length;
  const isBossMode = !!config.boss;
  const teamSize = config.teams?.size;

  config.speciesIds.forEach((speciesId, index) => {
    const instanceId = `p${index}-${speciesId}`;
    // Outside Boss Mode/Team Mode, each Pokémon gets its own unique team (its
    // own instance id) so `team` never restricts anything in the
    // free-for-all — Boss Mode's shared 'party' team makes allies mutually
    // untargetable, and Team Mode's 'teamA'/'teamB' split (the first
    // `teamSize` spawn indices vs. the rest — see circlePosition, which lays
    // indices out clockwise from the top, so a contiguous half naturally
    // clusters on one side of the arena) does the same per side.
    const team = isBossMode ? 'party' : teamSize !== undefined ? (index < teamSize ? 'teamA' : 'teamB') : instanceId;
    const position = circlePosition(index, count, config.arena);
    const instance = buildInstance(speciesId, instanceId, team, position, species, moves, rng, config.level, config.customMoves, false);
    pokemon[instanceId] = instance;
    livingOrder.push(instanceId);
  });

  if (config.boss) {
    const instanceId = `boss-${config.boss.speciesId}`;
    const instance = buildInstance(
      config.boss.speciesId,
      instanceId,
      'boss',
      arenaCenter(config.arena),
      species,
      moves,
      rng,
      config.level,
      undefined,
      true
    );
    pokemon[instanceId] = instance;
    livingOrder.push(instanceId);
  }

  return {
    tick: 0,
    elapsedMs: 0,
    pokemon,
    allInstanceIds: [...livingOrder],
    livingOrder,
    eliminationOrder: [],
    phase: 'intro',
    winnerInstanceIds: [],
    arena: config.arena,
    introDurationMs: computeIntroDurationMs(livingOrder.length),
    shiny: config.shiny,
    teams: config.teams,
  };
}
