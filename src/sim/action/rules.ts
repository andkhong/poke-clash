import type { MoveDefinition } from '../types';

// Tuning for Play Mode — the player-controlled real-time battle (see
// ActionEngine.ts). Every number here is a first guess from the design
// mock-up, meant to be tuned in playtests; nothing else in src/sim/ reads them.
// Distances are arena px (the same units as the spectator sim's CHASE_SPEED).

/** Runs faster than the spectator sim's 20 Hz: input has to feel immediate. */
export const ACTION_TICK_MS = 1000 / 60;

/** Fights need to last long enough to aim and dodge. */
export const HP_MULTIPLIER = 6;
export const ACTION_MATCH_LIMIT_MS = 180_000;
/** Invulnerable after a Revive, so nobody gets farmed on their spawn point. */
export const SPAWN_SHIELD_MS = 1500;

// Movement: velocity eases toward the input and bleeds off without it,
// hard-capped at MAX_SPEED (a touch above the spectator sim's CHASE_SPEED). Only a dash goes faster.
export const MAX_SPEED = 300;
export const ACCEL_RATE = 10;
export const FRICTION_RATE = 7;
export const PARALYSIS_MOVE_MULT = 0.5;
/** Above this a fighter reads as walking (Walk animation) rather than idle. */
export const WALK_THRESHOLD = 20;

export const DASH_SPEED = 1500;
export const DASH_MS = 150;
export const DASH_INVULN_MS = 200;
export const DASH_CHARGES = 2;
export const DASH_RECHARGE_MS = 3000;

/** Knockback is a separate decaying shove, not walking velocity, so the speed cap doesn't eat it. */
export const KNOCKBACK_PHYSICAL = 520;
export const KNOCKBACK_SPECIAL = 320;
export const KNOCKBACK_DECAY_RATE = 12;

export const ENERGY_MAX = 100;
export const ENERGY_REGEN_PER_SEC = 12;
/** Stops all four moves going out on the same frame. */
export const GLOBAL_COOLDOWN_MS = 250;
/** Sleep/freeze "turns" — shorter than the spectator sim's 2 s, being stunned in an action game hurts. */
export const ACTION_STATUS_TURN_MS = 1000;
/** How long a fighter keeps facing where it just fired before movement turns it again. */
export const AIM_FACING_MS = 300;

/** Physical moves are short, fast swipes; special and status moves are slower ranged shots. */
export const PROJECTILE = {
  physical: { speed: 1100, range: 170, radius: 30 },
  ranged: { speed: 650, range: 560, radius: 22 },
} as const;
/** all-enemies-in-radius moves (Earthquake, Heat Wave, Surf…) burst around the user. */
export const AOE_RADIUS = 220;

/** PP is never spent; it sets the move's pace. Higher PP = shorter cooldown and cheaper.
 * 15 PP lands on the spectator sim's 1.6 s BASE_ACTION_COOLDOWN_MS. */
export function moveCooldownMs(pp: number): number {
  return Math.min(5000, Math.max(600, 24_000 / Math.max(1, pp)));
}

export function moveEnergyCost(pp: number): number {
  return Math.round(200 / Math.max(1, pp));
}

export type MoveKind = 'physical' | 'ranged' | 'aoe' | 'self';

export function moveKind(move: MoveDefinition): MoveKind {
  if (move.targeting === 'self') return 'self';
  if (move.targeting === 'all-enemies-in-radius') return 'aoe';
  return move.category === 'physical' ? 'physical' : 'ranged';
}

// Crowd Calls (see playProtocol.ts): the cards a team's spectators vote onto it.
export const CROWD_SPEED_MULT = 1.3;
export const CROWD_SPEED_MS = 4000;
/** A shield soaks up the next hit whole, or fades unused after this. */
export const CROWD_SHIELD_MS = 3000;
export const SUPPLY_HEAL_FRACTION = 0.25;
export const SUPPLY_TTL_MS = 10_000;
/** Touch distance is this plus the fighter's own collision radius. */
export const SUPPLY_RADIUS = 28;
