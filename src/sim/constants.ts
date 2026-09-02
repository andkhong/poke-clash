// Single source of truth for tunable simulation constants. Values are initial
// proposals from the design pass — expect to retune during the QA/balance phase.

export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/**
 * Opening beat: a Pokéball drops in at each spawn position in clockwise order
 * (see matchSetup.ts's circlePosition — index 0..N-1 already runs clockwise
 * from the top), then pops open to reveal the Pokémon. Pokémon hold their
 * spawn-circle formation (no movement/actions) for the whole intro, under the
 * "WHO WILL WIN?" banner. Both the sim (gating movement) and the renderer
 * (staggering each ball's drop) derive timing from this one formula so they
 * never drift out of sync.
 */
export const BALL_DROP_STAGGER_MS = 130;
export const BALL_DROP_DURATION_MS = 550;
export const INTRO_BUFFER_MS = 400;

export function computeIntroDurationMs(rosterSize: number): number {
  return rosterSize * BALL_DROP_STAGGER_MS + BALL_DROP_DURATION_MS + INTRO_BUFFER_MS;
}

// ~9:19.5 — a modern phone-portrait ratio (edge-to-edge on current devices
// like iPhone 14/15 and most current Android), rather than the old 3:5 shape.
export const ARENA_WIDTH = 900;
export const ARENA_HEIGHT = 1950;

/** Distance at which a Pokémon notices a living enemy and begins chasing. */
export const AGGRO_RADIUS = 320;
/** Distance at which a Pokémon can execute an attack against its target. */
export const ENGAGE_RANGE = 220;
/** A target further than AGGRO_RADIUS * LEASH_MULTIPLIER away is dropped (disengage). */
export const LEASH_MULTIPLIER = 1.5;
/** How often (ms) an already-engaged Pokémon re-evaluates whether a better target exists. */
export const RETARGET_INTERVAL_MS = 2000;

export const BASE_ACTION_COOLDOWN_MS = 1600;
export const MIN_ACTION_COOLDOWN_MS = 800;
export const MAX_ACTION_COOLDOWN_MS = 3000;
/** Reference speed stat the cooldown formula is centered on. */
export const BASELINE_SPEED = 100;
/** A landed priority move shortens the user's *next* cooldown by this fraction. */
export const PRIORITY_COOLDOWN_DISCOUNT = 0.25;

export const STATUS_TICK_INTERVAL_MS = 1000;
export const BURN_CHIP_FRACTION = 1 / 16;
export const POISON_CHIP_FRACTION = 1 / 8;

export const CRIT_CHANCE = 1 / 24;
export const HIGH_CRIT_CHANCE = 1 / 8;
export const CRIT_DAMAGE_MULT = 1.5;
export const STAB_MULT = 1.5;
export const BURN_PHYSICAL_DAMAGE_MULT = 0.5;

/** Paralysis: chance the Pokémon simply fails to act this turn. */
export const PARALYSIS_FULL_PARA_CHANCE = 0.25;
/** Paralysis: multiplicative Speed penalty (applied in statCalc, not as a stage). */
export const PARALYSIS_SPEED_MULT = 0.5;

/** Freeze: chance to thaw on a given action attempt. */
export const FREEZE_THAW_CHANCE = 0.2;

/** Sleep/Freeze duration range, in "actions" (decremented on the action-cooldown cadence). */
export const SLEEP_MIN_TURNS = 1;
export const SLEEP_MAX_TURNS = 3;

/** Movement */
export const WANDER_SPEED = 60; // px/s
export const CHASE_SPEED = 90; // px/s
export const ARRIVAL_SLOWDOWN_RADIUS = 40;
export const SEPARATION_RADIUS = 48;
export const SEPARATION_STRENGTH = 80;
export const ARENA_PADDING = 48;

/** Spread-move splash radius around the primary target. */
export const SPREAD_MOVE_RADIUS = 180;

/** Soft stalemate failsafe: past this elapsed time, damage dealt escalates to force a finish. */
export const STALEMATE_TIMEOUT_MS = 3 * 60 * 1000;
export const STALEMATE_DAMAGE_RAMP_PER_MS = 0.0005; // fractional bonus multiplier per ms past timeout
