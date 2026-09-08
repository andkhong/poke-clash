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

/**
 * Match clock: a match can never run past MATCH_TIME_LIMIT_MS — whoever's
 * still standing at that instant is declared a (possibly shared) winner. From
 * AGGRESSION_TRIGGER_MS onward, every Pokémon moves faster, attacks more
 * often, and hunts more relentlessly (bigger aggro radius, longer leash,
 * faster retargeting) — this is what actually drives matches to a real
 * resolution before the clock runs out, replacing an earlier "ramp damage
 * after 3 minutes" failsafe that was tuned for a much longer match length.
 */
export const AGGRESSION_TRIGGER_MS = 45_000;
export const MATCH_TIME_LIMIT_MS = 90_000;

export function isAggressivePhase(elapsedMs: number): boolean {
  return elapsedMs >= AGGRESSION_TRIGGER_MS;
}

/** How long after the intro ends every Pokémon stays in a pure, untargeted
 * wander — no chasing, no attacking — before real combat is allowed to
 * begin. Measured from when battle phase actually starts (elapsedMs -
 * introDurationMs), not raw match time, since the intro itself already takes
 * longer for a bigger roster. */
export const COMBAT_START_DELAY_MS = 3000;

export function isBeforeCombatStart(elapsedMs: number, introDurationMs: number): boolean {
  return elapsedMs - introDurationMs < COMBAT_START_DELAY_MS;
}

/** Distance at which a Pokémon notices a living enemy and begins chasing. */
export const AGGRO_RADIUS = 320;
export const AGGRO_RADIUS_AGGRESSIVE = 520;
/** Distance at which a Pokémon can execute an attack against its target. */
export const ENGAGE_RANGE = 220;
export const ENGAGE_RANGE_AGGRESSIVE = 280;
/** A target further than AGGRO_RADIUS * LEASH_MULTIPLIER away is dropped (disengage). */
export const LEASH_MULTIPLIER = 1.5;
export const LEASH_MULTIPLIER_AGGRESSIVE = 3;
/** How often (ms) an already-engaged Pokémon re-evaluates whether a better target exists. */
export const RETARGET_INTERVAL_MS = 2000;
export const RETARGET_INTERVAL_MS_AGGRESSIVE = 700;

export const BASE_ACTION_COOLDOWN_MS = 1600;
export const MIN_ACTION_COOLDOWN_MS = 800;
export const MIN_ACTION_COOLDOWN_MS_AGGRESSIVE = 400;
export const MAX_ACTION_COOLDOWN_MS = 3000;
/** Reference speed stat the cooldown formula is centered on. */
export const BASELINE_SPEED = 100;
/** A landed priority move shortens the user's *next* cooldown by this fraction. */
export const PRIORITY_COOLDOWN_DISCOUNT = 0.25;
/** Applied to movement speed and inversely to action cooldown once aggressive. */
export const AGGRESSIVE_SPEED_MULTIPLIER = 1.6;
export const AGGRESSIVE_COOLDOWN_MULTIPLIER = 0.55;

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
export const WANDER_SPEED = 180; // px/s (3x)
export const CHASE_SPEED = 270; // px/s (3x)
export const ARRIVAL_SLOWDOWN_RADIUS = 40;
export const ARENA_PADDING = 48;
/**
 * Extra-tall clamp for the arena's top edge only — reserves a strip at the
 * top of the map for the roster/HP HUD panel (RosterPanel, rendered as a
 * screen overlay outside the sim) so it never has to render over (or get
 * walked under by) a live Pokémon. Kept as a fixed fraction of ARENA_HEIGHT
 * rather than measured from the actual DOM panel height, since the sim's
 * arena bounds are shared/authoritative and can't depend on any one client's
 * screen layout — sized generously for the largest roster's HUD footprint at
 * the near-1:1 phone display scale ARENA_WIDTH/HEIGHT are tuned for.
 */
export const ARENA_TOP_PADDING = 200;

/**
 * On-screen sprite scale — shared with the renderer (PokemonSprite.ts uses
 * these same 3 constants for visual size) so a Pokémon's hitbox actually
 * matches what's drawn on screen. PMD frame sizes are authored at consistent
 * in-game scale (a Wailord's frame really is bigger than a Voltorb's), so
 * every species shares this one multiplier rather than being normalized to a
 * fixed box. See PokemonSprite.ts for the full distribution/tuning rationale.
 */
export const PMD_NATIVE_SCALE = 3.375;
export const PMD_MIN_SPRITE_SIZE = 84;
export const PMD_MAX_SPRITE_SIZE = 270;

/** Collision/separation radius as a fraction of a species' on-screen size —
 * smaller than a full circumscribing circle (0.5) since sprites aren't solid
 * squares; ~0.35 approximates the actual body footprint reasonably. */
export const COLLISION_RADIUS_FACTOR = 0.35;

/** How far beyond two Pokémon's combined collision radii (i.e. beyond
 * actually touching) the soft steering nudge starts easing them apart. The
 * hard positional correction in resolveCollisions() is what actually
 * guarantees no overlap — this just makes the approach look smooth instead
 * of Pokémon visibly bumping into an invisible wall. */
export const SEPARATION_INFLUENCE_MULTIPLIER = 1.15;
export const SEPARATION_STRENGTH = 35;

/** Spread-move splash radius around the primary target. */
export const SPREAD_MOVE_RADIUS = 180;
