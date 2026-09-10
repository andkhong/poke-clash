// Single source of truth for tunable simulation constants. Values are initial
// proposals from the design pass — expect to retune during the QA/balance phase.

import type { ArenaBounds } from './types';

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
 * Widescreen arena a non-mobile (desktop/web) browser can opt into — see
 * app/config.ts's resolveMatchArena() and useWideArenaPreference(). Mobile
 * devices are hard-locked to the portrait arena above and never offered
 * this. 1920x1080 was picked over an arbitrarily-scaled shape because its
 * diagonal (~2202px) lands almost
 * exactly on the portrait arena's own (~2147px, see NO_WANDER_AGGRO_RADIUS's
 * comment below) — every absolute-pixel gameplay constant tuned around the
 * portrait arena (AGGRO_RADIUS, movement speeds, etc.) carries over to this
 * shape without needing a second tuning pass.
 */
export const DESKTOP_ARENA_WIDTH = 1920;
export const DESKTOP_ARENA_HEIGHT = 1080;

/** True for a portrait ("mobile") arena, false for a landscape ("desktop")
 * one — derived from the arena's own shape rather than stored anywhere, so
 * MatchConfig/the network protocol never need a companion "which layout is
 * this" field just to stay in sync with it. */
export function isMobileArena(arena: ArenaBounds): boolean {
  return arena.width < arena.height;
}

/**
 * Fraction of arena width/height reserved on each edge so Pokémon never
 * wander behind where Instagram's own Story-viewer UI would sit once a
 * match is recorded and posted — the whole reason this arena is shaped like
 * a vertical video frame in the first place. Read directly off Instagram's
 * own 1080x1920 Story safe-zone template (profile/close-button strip along
 * the top, reply-bar strip along the bottom, and a narrower margin on both
 * sides so nothing sits flush against the frame's outer edge): the visual
 * reference measured out to roughly top 13%, bottom 11%, and left/right 7%
 * each. Easy to retune since nothing else depends on these exact values.
 * Only meaningful for a portrait/mobile arena — a landscape desktop arena
 * isn't a vertical-video export, so it gets no reservation at all.
 */
export const RED_ZONE_TOP_FRACTION = 0.13;
export const RED_ZONE_BOTTOM_FRACTION = 0.11;
export const RED_ZONE_LEFT_FRACTION = 0.07;
export const RED_ZONE_RIGHT_FRACTION = 0.07;

export interface RedZoneInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function getRedZoneInsets(arena: ArenaBounds): RedZoneInsets {
  if (!isMobileArena(arena)) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: arena.height * RED_ZONE_TOP_FRACTION,
    right: arena.width * RED_ZONE_RIGHT_FRACTION,
    bottom: arena.height * RED_ZONE_BOTTOM_FRACTION,
    left: arena.width * RED_ZONE_LEFT_FRACTION,
  };
}

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

/** Effective aggro-discovery (and leash) radius when MatchConfig.disableWander
 * is set — comfortably past the diagonal of even the largest arena this game
 * offers (the default 900x1950 arena's diagonal is ~2147px), so
 * pickWeightedRandomTarget (ai.ts) always finds any living enemy regardless
 * of arena size, and LEASH_MULTIPLIER's distance-based disengage never
 * triggers. A large finite number rather than Infinity, so it stays safe to
 * feed into rngWeightedPick's weight arithmetic (rng.ts). */
export const NO_WANDER_AGGRO_RADIUS = 10_000;

/** How long (ms) a Pokémon holds perfectly still — velocity zeroed, same as
 * the 'attack' AI state — after firing any move, independent of (and often
 * longer than) its actionCooldownMs, before movement.ts is allowed to move
 * it again. Also used verbatim by ArenaScene as its attack visual window
 * (pose/label/sound duration + when the renderer's own cosmetic position
 * lock releases): the two used to be separate constants that could drift out
 * of sync — the render freezing a Pokémon's on-screen position while the sim
 * had already moved it via 'wander' underneath, so the instant the render
 * lock released, the view had to snap/dash to catch up to wherever the sim
 * really was. Sharing one constant means the sim's own position genuinely
 * hasn't moved by the time the render considers the attack over, so there's
 * nothing left to catch up on. */
export const POST_ATTACK_HOLD_MS = 1200;

export const BASE_ACTION_COOLDOWN_MS = 1600;
/** The real floor on how soon *anyone* can attack again, no matter how fast —
 * pinned to POST_ATTACK_HOLD_MS (both here and for the aggressive-phase
 * variant below) so a Pokémon's next attack can never fire before its
 * current one's own hold/visual window has even finished. Left lower (800ms,
 * 400ms aggressive) than POST_ATTACK_HOLD_MS, a fast Pokémon's cooldown
 * formula below would clamp to that lower floor and let it queue a second
 * attack while the first one's pose/label/sound was still playing — reading
 * as attacking nonstop with no real pause, regardless of Speed. Speed still
 * fully controls pacing *above* this shared floor via the BASELINE_SPEED
 * formula below — slower Pokémon get a correspondingly longer delay; this
 * only caps how short that delay can ever get. */
export const MIN_ACTION_COOLDOWN_MS = POST_ATTACK_HOLD_MS;
export const MIN_ACTION_COOLDOWN_MS_AGGRESSIVE = POST_ATTACK_HOLD_MS;
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
 * On-screen sprite scale — shared with the renderer (PokemonSprite.ts derives
 * its Phaser texture scale from the same computeOnScreenSizeFromHeight() this
 * feeds into loader.ts's collisionRadius) so a Pokémon's hitbox always
 * matches what's actually drawn.
 *
 * Driven by each species' real height (GeneratedSpecies.heightDm, from
 * PokeAPI), not its PMD idle-animation frame's own pixel dimensions — that
 * frame's canvas size varies with incidental animation padding as much as
 * with real size (Pikachu's ears+tail stick up during its idle wiggle,
 * giving it a *taller* Idle frame than Blastoise's compact shell), so two
 * species close in real size could land in the wrong relative order on
 * screen. Height doesn't have that problem. A straight sqrt (rather than
 * linear) keeps the giant handful of 100+dm legendaries from dwarfing
 * everything else while still keeping genuinely small Pokémon small — heights
 * across the full roster span 1-200dm (median 10dm), so linear scaling would
 * either make most of the roster nearly the same size or let the rare giant
 * swallow the arena. POKEMON_HEIGHT_SCALE is picked so a ~16dm Pokémon (a
 * Blastoise, Charizard, Venusaur-ish mid-size) lands around 100px — matched
 * against the reference battle footage this game is modeled on (see
 * examples/ and the "improved asset for upload" commit).
 */
export const POKEMON_HEIGHT_SCALE = 25;
export const PMD_MIN_SPRITE_SIZE = 84;
export const PMD_MAX_SPRITE_SIZE = 270;

export function computeOnScreenSizeFromHeight(heightDm: number): number {
  const scaled = Math.sqrt(Math.max(1, heightDm)) * POKEMON_HEIGHT_SCALE;
  return Math.min(PMD_MAX_SPRITE_SIZE, Math.max(PMD_MIN_SPRITE_SIZE, scaled));
}

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
