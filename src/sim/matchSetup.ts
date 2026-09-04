import type {
  ArenaBounds,
  MatchConfig,
  MoveDefinition,
  MoveSlot,
  PokemonInstance,
  PokemonTypeName,
  SimState,
  StatBlock,
} from './types';
import type { Rng } from './rng';
import { rngShuffle } from './rng';
import { computeStats, createNeutralStages } from './statCalc';
import { computeIntroDurationMs } from './constants';

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

function pickMoveSlots(pool: readonly number[], moves: MoveLookup, rng: Rng): MoveSlot[] {
  const shuffled = rngShuffle(rng, pool);
  const slots: MoveSlot[] = [];
  for (const moveId of shuffled) {
    if (slots.length >= 4) break;
    const def = moves(moveId);
    if (!def) continue;
    slots.push({ moveId, ppRemaining: def.pp, ppMax: def.pp });
  }
  return slots;
}

function circlePosition(index: number, count: number, arena: ArenaBounds): { x: number; y: number } {
  const centerX = arena.width / 2;
  const centerY = arena.height / 2;
  const radius = Math.min(arena.width, arena.height) * 0.32;
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return {
    x: centerX + Math.cos(angle) * radius,
    y: centerY + Math.sin(angle) * radius,
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

  config.speciesIds.forEach((speciesId, index) => {
    const data = species[speciesId];
    if (!data) throw new Error(`Unknown species id ${speciesId} in match config`);

    const instanceId = `p${index}-${speciesId}`;
    const computedStats = computeStats(data.baseStats, config.level);
    const position = circlePosition(index, count, config.arena);

    const instance: PokemonInstance = {
      instanceId,
      speciesId,
      name: data.name,
      level: config.level,
      types: data.types,
      baseStats: data.baseStats,
      computedStats,
      statStages: createNeutralStages(),
      currentHp: computedStats.hp,
      maxHp: computedStats.hp,
      moves: pickMoveSlots(data.movePool, moves, rng),
      status: null,
      statusTickAccumMs: 0,
      position,
      velocity: { x: 0, y: 0 },
      facing: 'S',
      collisionRadius: data.collisionRadius,
      aiState: 'wander',
      targetInstanceId: null,
      lastRetargetMs: 0,
      actionCooldownMs: 0,
      wanderWaypoint: undefined,
    };

    pokemon[instanceId] = instance;
    livingOrder.push(instanceId);
  });

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
    introDurationMs: computeIntroDurationMs(count),
  };
}
