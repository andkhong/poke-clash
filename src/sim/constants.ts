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
 * "PLACE YOUR BETS!" banner. Both the sim (gating movement) and the renderer
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

/** A per-edge reservation measured inward from the arena's own edges. */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export type RedZoneInsets = EdgeInsets;

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function getRedZoneInsets(arena: ArenaBounds): EdgeInsets {
  if (!isMobileArena(arena)) return NO_INSETS;
  return {
    top: arena.height * RED_ZONE_TOP_FRACTION,
    right: arena.width * RED_ZONE_RIGHT_FRACTION,
    bottom: arena.height * RED_ZONE_BOTTOM_FRACTION,
    left: arena.width * RED_ZONE_LEFT_FRACTION,
  };
}

/**
 * The landscape (desktop) arena's floor is a single image,
 * map-assets/wide-background.jpg — a fenced-in pitch with woods around it,
 * shipped as the 1920x1080 wide-background.webp made from it (only the
 * proportions matter here) — drawn scaled up to cover the arena (see render/tileset/arenaBackground.ts's
 * drawCoverImage). The fence is the playable area's border: nothing may
 * walk through it, so the sim needs to know where it is. `fence` is the
 * inner face of the fence rails/posts in the image's own pixels, read off
 * the 1200x675 source: the left rail at x≈220, the top rail at y≈72 with
 * its posts reaching down to y≈88, the bottom rail at y≈575 with its posts
 * starting at y≈565, and on the right the upper run of fence at x≈953 —
 * the lower run past the dirt path's gap sits further out (x≈982), but one
 * straight line at the nearer run keeps everyone inside both. The left
 * side's paddock (behind the gate, x≈95-220) and that right-hand path are
 * outside the border. Only meaningful for a landscape arena — the portrait
 * arena draws a different map and keeps its fixed ARENA_PADDING edge buffer
 * + red zone (getRedZoneInsets).
 */
export const WIDE_ARENA_MAP = {
  width: 1200,
  height: 675,
  fence: { left: 224, top: 88, right: 948, bottom: 565 },
} as const;

/**
 * How far in from each of a landscape arena's edges the wide map's fence
 * line falls (see WIDE_ARENA_MAP), i.e. the border a Pokémon is kept
 * inside — zero on every side of a portrait arena, which has no fence.
 * Mirrors the renderer's cover-scaling exactly (the image scaled up
 * uniformly until it covers the arena, then centred), so the sim's border
 * is the drawn fence whatever the arena's size: the desktop arena and any
 * scale-down of it are the image's own 16:9, so nothing is cropped and each
 * inset is just the image's proportionally; any other
 * landscape shape crops the image's long side, and an edge whose fence
 * lands off-arena in that crop is clamped to the arena edge itself.
 */
export function getFenceInsets(arena: ArenaBounds): EdgeInsets {
  if (isMobileArena(arena)) return NO_INSETS;
  const { width, height, fence } = WIDE_ARENA_MAP;
  const scale = Math.max(arena.width / width, arena.height / height);
  const offsetX = (arena.width - width * scale) / 2;
  const offsetY = (arena.height - height * scale) / 2;
  return {
    left: Math.max(0, offsetX + fence.left * scale),
    top: Math.max(0, offsetY + fence.top * scale),
    right: Math.max(0, arena.width - (offsetX + fence.right * scale)),
    bottom: Math.max(0, arena.height - (offsetY + fence.bottom * scale)),
  };
}

/** Betting on an online match closes this far in (see game-server/playRooms.ts). */
export const AGGRESSION_TRIGGER_MS = 45_000;

/** The move review page's attack visual window: pose, label and sound (see src/review). */
export const POST_ATTACK_HOLD_MS = 1200;

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

/** Freeze: chance to thaw on each of the frozen Pokémon's turns (see
 * STATUS_TURN_INTERVAL_MS). A Fire-type hit thaws it outright regardless. */
export const FREEZE_THAW_CHANCE = 0.2;
/** Freeze always ends by this many turns even if every thaw roll fails — the
 * mainline games let freeze run indefinitely, but a match on a hard clock can't afford a
 * Pokémon sitting out a quarter of it on a bad streak. With
 * STATUS_TURN_INTERVAL_MS below, that's a 2-8s freeze. */
export const FREEZE_MAX_TURNS = 4;

/** Sleep duration range, in turns (see STATUS_TURN_INTERVAL_MS). */
export const SLEEP_MIN_TURNS = 1;
export const SLEEP_MAX_TURNS = 3;

/**
 * How often (ms) a sleeping/frozen Pokémon gets a "turn" — the cadence its
 * sleep counter ticks down / its thaw chance is rolled on. Such a Pokémon
 * never attacks, so the normal attack path (which is where a paralyzed
 * Pokémon rolls its own full-para chance) never runs for it — engine.ts's
 * tickIncapacitated gives it this fixed cadence instead, on the same
 * actionCooldownMs timer everyone else paces their attacks on. Sized to the
 * middle of the normal attack-cooldown range (BASE_ACTION_COOLDOWN_MS to
 * MAX_ACTION_COOLDOWN_MS) so a "turn" asleep is about as long as a turn
 * fighting: a 1-3 turn sleep is 2-6s, a freeze at most FREEZE_MAX_TURNS × this.
 */
export const STATUS_TURN_INTERVAL_MS = 2000;

export const CHASE_SPEED = 270; // px/s (3x)

/** Fixed buffer between a Pokémon's position and the playable area's edge —
 * the arena's own edge on a portrait arena, the wide map's fence line (see
 * getFenceInsets) on a landscape one. Sized to about a typical sprite's
 * collision radius so its body stops at the line rather than its centre. */
export const ARENA_PADDING = 48;
/**
 * Extra-tall clamp for the arena's top edge only — reserves a strip at the
 * top of the map for the roster/HP HUD panel (RosterPanel, rendered as a
 * screen overlay outside the sim) so it never has to render over (or get
 * walked under by) a live Pokémon. Kept as a fixed sim-pixel value rather
 * than measured from the actual DOM panel height, since the sim's arena
 * bounds are shared/authoritative and can't depend on any one client's
 * screen layout.
 *
 * In practice this only ever binds on the landscape (desktop) arena —
 * getMovementBounds takes Math.max(this, redZone.top, fence.top +
 * ARENA_PADDING), and the portrait arena's own red-zone top inset
 * (getRedZoneInsets) is bigger than this on its own. So it has to be sized
 * for the landscape arena's HUD, which is a plain DOM overlay in fixed CSS
 * pixels (RosterPanel's own font/padding, not scaled) sitting over a Phaser
 * canvas that's *never* shown at this arena's native 1920px width — the
 * desktop match frame (MatchScreen's desktopFrameStyle) caps it well below
 * that — so the HUD's real footprint in sim pixels is always bigger than its
 * on-screen footprint in CSS pixels, roughly by 1920/(displayed frame
 * width). Sized with real margin over the HUD's footprint at that frame's
 * smallest realistic width instead of at the theoretical 1:1 scale, which is
 * what let the HUD start covering Pokémon fighting near the top edge.
 */
export const ARENA_TOP_PADDING = 240;

/**
 * On-screen sprite scale — shared with the renderer (PokemonSprite.ts derives
 * its Phaser texture scale from the same number this feeds into loader.ts's
 * collisionRadius) so a Pokémon's hitbox always matches what's drawn.
 *
 * Every PMD sprite is drawn at one uniform magnification, PMD_SPRITE_SCALE,
 * of its *visible body* — the bounding box of its non-transparent pixels
 * across its Idle frames in every facing, measured by
 * data-pipeline/measure-pmd-bodies.ts into src/data/generated/pmdBodySizes.json
 * (see src/data/pmdBodySizes.ts). Uniform because that's what makes a
 * pixel-art roster read as one set: every Pokémon's pixels are the same
 * size on screen, and PMDCollab's artists already drew each species at a
 * consistent relative scale (a Wailord's sheet is bigger than a Joltik's),
 * so relative size comes free without any per-species formula. The
 * magnification is matched against the reference battle footage this game
 * is modeled on (see examples/): a fully evolved starter — Blaziken,
 * Torterra, Greninja — stands ~85-100px in the 900px-wide portrait arena,
 * about a tenth of the frame's width.
 *
 * Only the extremes are clamped: the visible body's longest side is kept
 * within PMD_MIN_BODY_SIZE (a Joltik would otherwise be a ~50px speck) and
 * PMD_MAX_BODY_SIZE (a Moltres with wings spread would otherwise span a
 * quarter of the arena), which costs those few species (~5% at each end)
 * the shared pixel size.
 *
 * Why the visible body and not the sheet's frame canvas: PMDCollab pads
 * every frame for its animation's full range of motion, by an amount that
 * varies from ~40% to ~98% of the canvas per species. Scaling the canvas
 * to a target size (what this used to do, driven by a sqrt of the species'
 * real height) put two same-size Pokémon at very different on-screen sizes
 * and magnifications — a Blaziken at 1.95x next to a Swampert at 1.5x and a
 * Serperior at 3x — with a median visible body of only ~50px.
 */
export const PMD_SPRITE_SCALE = 3;
export const PMD_MIN_BODY_SIZE = 64;
export const PMD_MAX_BODY_SIZE = 150;

/** On-screen size (px, longest side) of a PMD sprite whose visible body's
 * longest side is `bodyPx` native sheet pixels. */
export function computeOnScreenSizeFromBody(bodyPx: number): number {
  const scaled = Math.max(1, bodyPx) * PMD_SPRITE_SCALE;
  return Math.min(PMD_MAX_BODY_SIZE, Math.max(PMD_MIN_BODY_SIZE, scaled));
}

/**
 * Fallback for a species with no measured PMD body — none of the selectable
 * roster (see loader.ts's hasPmdSprite), but the hotlink-art tier in
 * PokemonSprite.ts can still render one: an estimate from the species' real
 * height (GeneratedSpecies.heightDm, from PokeAPI). A sqrt rather than
 * linear keeps the giant handful of 100+dm legendaries from dwarfing
 * everything else (heights span 1-200dm, median 10dm), and
 * POKEMON_HEIGHT_SCALE puts a ~16dm Pokémon at ~100px — the same band
 * computeOnScreenSizeFromBody lands a measured sprite of that size in,
 * clamped to the same bounds.
 */
export const POKEMON_HEIGHT_SCALE = 25;

export function computeOnScreenSizeFromHeight(heightDm: number): number {
  const scaled = Math.sqrt(Math.max(1, heightDm)) * POKEMON_HEIGHT_SCALE;
  return Math.min(PMD_MAX_BODY_SIZE, Math.max(PMD_MIN_BODY_SIZE, scaled));
}

/** Collision/separation radius as a fraction of a species' on-screen size
 * (its visible body's longest side). Half would be the tightest circle
 * around a sprite as wide as it is tall; most bodies are taller than wide
 * and not solid to their corners, so a touch under that lets two sprites
 * walk close enough to read as jostling without their bodies overlapping. */
export const COLLISION_RADIUS_FACTOR = 0.45;
