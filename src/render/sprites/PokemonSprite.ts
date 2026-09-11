import Phaser from 'phaser';
import type { FacingDirection, PokemonInstance, StatusCondition, Vec2 } from '../../sim/types';
import { CHASE_MOVE_SPEED, velocityToFacing } from '../../sim/movement';
import type { PmdAnimEntry, PmdSpriteIndex, SpriteIndex } from '../../data/types';
import { downgradeTier, resolveSpriteUrls, type SpriteUrls } from './spriteResolver';
import { loadGifAsAnimatedTexture } from './gifTexture';
import { acquireSpriteSlot, releaseSpriteSlot } from './fetchQueue';
import { getMoveTypeColor } from '../vfx/typeColor';
import { POKEBALL_TEXTURE_KEY } from './pokeballAsset';
import { playCry } from './cryAudio';
import { pmdSheetUrl } from './pmdSheetUrl';
import { createShinyAura, playSparkleReveal } from '../vfx/sparkle';
import { frameDurationMs, playAnimation, type AnimationHandle } from '../vfx/anim/AnimPlayer';
import { animationScaleFor } from '../vfx/anim/geometry';
import { getLoadedCommonAnimation } from '../vfx/anim/moveAnimLoader';
import { STATUS_COMMON_ANIMATIONS, playableFrameCount } from '../../data/moveAnimationFormat';
import type { MoveDefinition } from '../../sim/types';
import {
  ARENA_TOP_PADDING,
  BALL_DROP_DURATION_MS,
  BALL_DROP_STAGGER_MS,
  COLLISION_RADIUS_FACTOR,
  POST_ATTACK_HOLD_MS,
} from '../../sim/constants';
import { BOSS_CONFIG } from '../../sim/bossConfig';
import { getPmdBodySize } from '../../data/pmdBodySizes';

/** Target on-screen size (px, longest side) — sprite sources range from ~30px
 * PMD action frames to several-hundred-px official artwork, so every sprite
 * gets scaled to fit this regardless of its native resolution. 192 (50%
 * larger than a tight 128px fit) makes the arena's Pokémon read clearly at
 * the game's actual viewing size. */
const TARGET_SPRITE_SIZE = 192;
const POKEBALL_ICON_SIZE = 34;
const PLACEHOLDER_RADIUS = 24;
const HP_BAR_WIDTH = 56;
const HP_BAR_HEIGHT = 6;
/** Gap (px) between the HP bar and the sprite's actual bottom edge (feet). */
const HP_BAR_GAP = 4;
/** Gap (px) between the HP bar's bottom edge and the status box under it. */
const STATUS_BOX_GAP = 3;
const STATUS_BOX_FONT_SIZE = 8;
const STATUS_BOX_PAD_X = 5;
const STATUS_BOX_PAD_Y = 3;
const STATUS_BOX_CORNER_RADIUS = 4;
/** Gap (px) between the move-name label and the sprite's actual top edge. */
const MOVE_LABEL_GAP = 8;
/** Retro arcade-style pixel font, matching the reference battle-UI callout style. */
const MOVE_LABEL_FONT_FAMILY = '"Press Start 2P", monospace';
const MOVE_LABEL_FONT_SIZE = 13;
const MOVE_LABEL_PAD_X = 10;
const MOVE_LABEL_PAD_Y = 7;
const MOVE_LABEL_CORNER_RADIUS = 6;
const MOVE_LABEL_BORDER_WIDTH = 2;
const MOVE_LABEL_BORDER_COLOR = 0x1a1a1a;
/** How much lighter/darker the top/bottom of the label's gradient fill are
 * relative to the move's base type color, for a glossy beveled-button look. */
const MOVE_LABEL_SHADE_AMOUNT = 45;
const HIT_FLASH_MS = 160;
/** How far the arena's own lunge-family VFX (see playLungeAttack) dashes
 * the attacker's sprite toward its target, at most. Kept well under
 * typical inter-Pokémon spacing so a lunge reads as "closing the last bit
 * of distance to throw a punch," not a teleport across the arena. */
const MAX_LUNGE_DISTANCE = 130;
const LUNGE_OUT_MS = 120;
const LUNGE_BACK_MS = 170;
/** A missed move's target sidesteps out of the attack's path (see
 * playDodge): a quick hop across the line of attack, a beat there while
 * the effect lands where it stood, then back. Distance scales with the
 * sprite's size, within these bounds, so a Wailord's dodge reads as much
 * as a Pikachu's. */
const DODGE_DISTANCE_FACTOR = 0.35;
const DODGE_MIN_PX = 20;
const DODGE_MAX_PX = 48;
const DODGE_OUT_MS = 110;
const DODGE_HOLD_MS = 120;
const DODGE_BACK_MS = 170;
/** The "MISS" callout that pops above a dodging target — same pixel font
 * as the move label, rising and fading like a damage number. */
const MISS_CALLOUT_FONT_SIZE = 11;
const MISS_CALLOUT_RISE_PX = 30;
const MISS_CALLOUT_LIFESPAN_MS = 800;
const MISS_CALLOUT_POP_MS = 120;
/** One-shot (play-once, non-looping) PMD actions — everything else registered
 * on a species (Idle/Walk/Sleep) loops. */
const ONE_SHOT_PMD_ACTIONS = new Set(['Attack', 'Shoot', 'Shock', 'SpAttack', 'Hurt', 'Faint']);
/** For a non-melee move (see playPmdAttack's `ranged` param), tried in order
 * against this species' available pmdActions — first match wins, falling
 * back to the generic Attack swing if the species has none of them. Shock and
 * SpAttack are rarer, more specific poses (no species has both — see
 * data-pipeline/pmdSpriteZip.ts) that read better than the generic Shoot pose
 * where available; Attack itself is listed last as the universal fallback
 * even though every PMD-tier species already has it (desiredPmdAction's own
 * fallback would otherwise leave a ranged attacker mid-Walk/Idle). */
const RANGED_ATTACK_ACTION_PRIORITY = ['Shock', 'SpAttack', 'Shoot', 'Attack'];
/** No distinct shiny art exists for any tier, so shininess is a uniform
 * recolor tint (Phaser's multiply-tint, which preserves shading/detail)
 * rather than genuinely different sprites — a common, well-understood
 * simplification. Matches the gold used by the setup screen's shiny toggle
 * and the shiny sparkle-burst color. */
const SHINY_TINT_COLOR = 0xffd700;
/** Slight glow ring marking the current multiplayer player's own pick, so
 * spectators can spot which Pokémon is theirs — see setHighlighted(). Uses
 * the app's general gold accent color, distinct from SHINY_TINT_COLOR so a
 * shiny pick is still visually distinguishable from "just shiny". */
const HIGHLIGHT_GLOW_COLOR = 0xe0b030;
const HIGHLIGHT_GLOW_OUTER_STRENGTH = 3;
const HIGHLIGHT_GLOW_QUALITY = 0.2;
const HIGHLIGHT_GLOW_DISTANCE = 12;
const BALL_DROP_HEIGHT = 260;
const BALL_STAGGER_JITTER_MS = 40;
/** How much of the gap to the true sim position to close each render frame —
 * gives smooth 60fps motion from a 20Hz sim without needing fixed-timestep
 * interpolation bookkeeping in the engine. */
const POSITION_SMOOTHING = 0.25;
/** Caps how far a single frame's smoothing step (above) is allowed to move
 * renderPos, in px/frame at an assumed 60fps — i.e. px/s ÷ 60. Set at
 * CHASE_SPEED (the sim's fastest normal movement speed, before the
 * aggressive-phase multiplier) so a capped catch-up never visibly outrun
 * anything a Pokémon legitimately does the rest of the time. Ordinary
 * tick-to-tick gaps during normal movement are well under this already, so
 * it never engages then — it only kicks in after something opens up a large
 * gap in one shot: chiefly the sim's own POST_ATTACK_HOLD_MS ending (see
 * engine.ts) landing a frame or two after the renderer's matching
 * lockPosition() releases, but also collision-resolution shoves or any other
 * one-tick jump. Without this, POSITION_SMOOTHING's percentage-based
 * catch-up closes a large gap almost entirely within a handful of frames,
 * reading as a teleport/snap rather than motion — clamping it forces the
 * same catch-up into a natural-looking glide instead. */
const MAX_POSITION_STEP_PER_FRAME = CHASE_MOVE_SPEED / 60;
/** Full words rather than the mainline games' three-letter codes — at arena
 * scale "PSN"/"BRN"/"FRZ" are easy to confuse, and there's room under every
 * sprite for the word (see buildStatusBox). */
const STATUS_LABELS: Record<StatusCondition, string> = {
  sleep: 'ASLEEP',
  paralysis: 'PARALYZED',
  burn: 'BURNED',
  poison: 'POISONED',
  freeze: 'FROZEN',
};
const STATUS_COLORS: Record<StatusCondition, number> = {
  sleep: 0x7b68c4,
  paralysis: 0xe0c030,
  burn: 0xe0703c,
  poison: 0x9048c0,
  freeze: 0x60c8e0,
};

/** Ambient per-status VFX, replayed for as long as the status lasts (see
 * updateStatusVfx) so a condition is visible on the body itself, not just
 * from the status box under it. Each plays the move-animation pack's own
 * status animation (Common:Poison/Burn/Paralysis/Frozen — see
 * STATUS_COMMON_ANIMATIONS) anchored on this sprite, with this much quiet
 * between replays; sleep's "Z" is plain text in the labels' own pixel
 * font. Purely cosmetic: driven off pokemon.status each frame, never fed
 * back into the sim. */
const STATUS_VFX_GAP_MS: Record<StatusCondition, number> = {
  paralysis: 700,
  sleep: 700,
  poison: 900,
  burn: 600,
  freeze: 1400,
};
/** Status animations run at this multiple of the pack's native 20 fps —
 * slower than attacks (see ATTACK_PLAYBACK_SPEED), since nothing waits on
 * them and a lazy ooze/smolder reads better than a frantic one. */
const STATUS_ANIM_PLAYBACK_SPEED = 1.5;
/** Retry cadence while a status animation's data is still downloading. */
const STATUS_ANIM_RETRY_MS = 500;
const SLEEP_Z_FONT_SIZE = 12;
const SLEEP_Z_LIFESPAN_MS = 1500;
/** Body tint while frozen — pale ice-blue, light enough that the sprite's
 * own detail still reads through it (see applyBodyTint). */
const FREEZE_BODY_TINT = 0xa8dcff;

/**
 * PMDCollab/SpriteCollab sheets lay out one row per compass direction, in a
 * fixed order verified against PMD2's own game data (pmd2scriptdata.xml:
 * "Sprites have 8 directions... DOWN is 0"). Real art exists per direction —
 * no flip/tilt approximation needed for this tier.
 */
const FACING_TO_ROW: Record<FacingDirection, number> = {
  S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7,
};

// A PMD-tier sprite's on-screen target size comes from the sim's own
// collisionRadius (see the constructor's targetOnScreenSize, and
// tryLoadPmdSprites() below) rather than being recomputed here.
// computeOnScreenSizeFromBody (sim/constants.ts) — which is what loader.ts
// used to derive that collisionRadius in the first place — is the species'
// measured visible body (src/data/pmdBodySizes.ts) at one magnification
// shared by the whole roster, so this is guaranteed to be the exact same
// number the sim used for its hitbox, and a Pokémon's visible size always
// matches what it can actually collide with. Dividing by that same measured
// body (not the sheet's padded frame canvas) is what turns it back into a
// texture scale.
//
// Unlike the hotlink tier below (which normalizes every sprite to
// TARGET_SPRITE_SIZE regardless of source resolution, since Showdown/PokeAPI
// art isn't drawn at a consistent relative scale), PMD species keep the
// relative proportions PMDCollab drew them at — a Wailord looks bigger than
// a Voltorb — and, since the magnification is uniform, the same pixel size.

/**
 * No hand-drawn art exists for diagonal facings (or for any Pokémon facing
 * beyond the 2 real official angles — front and back), so all 8 directions
 * are built from those 2 textures via flip + a small rotation: N/S show the
 * real back/front sprite outright, E/W mirror the front sprite, and the 4
 * diagonals additionally tilt a few degrees to lean toward the direction of
 * travel — a deliberate geometric approximation, not custom per-direction art.
 * (Fallback tier only, used when a species has no PMD sprite coverage.)
 */
const DIAGONAL_TILT_DEGREES = 12;
interface FacingRenderConfig {
  useBack: boolean;
  flip: boolean;
  tiltDeg: number;
}
const FACING_CONFIG: Record<FacingDirection, FacingRenderConfig> = {
  N: { useBack: true, flip: false, tiltDeg: 0 },
  S: { useBack: false, flip: false, tiltDeg: 0 },
  E: { useBack: false, flip: true, tiltDeg: 0 },
  W: { useBack: false, flip: false, tiltDeg: 0 },
  NE: { useBack: true, flip: true, tiltDeg: -DIAGONAL_TILT_DEGREES },
  NW: { useBack: true, flip: false, tiltDeg: DIAGONAL_TILT_DEGREES },
  SE: { useBack: false, flip: true, tiltDeg: DIAGONAL_TILT_DEGREES },
  SW: { useBack: false, flip: false, tiltDeg: -DIAGONAL_TILT_DEGREES },
};

/** Shifts each RGB channel of a 0xRRGGBB color by `amount` (negative to
 * darken), clamped to the valid byte range. Used for the move label's
 * top/bottom gradient stops. */
function shadeColor(hex: number, amount: number): number {
  const r = Phaser.Math.Clamp(((hex >> 16) & 0xff) + amount, 0, 255);
  const g = Phaser.Math.Clamp(((hex >> 8) & 0xff) + amount, 0, 255);
  const b = Phaser.Math.Clamp((hex & 0xff) + amount, 0, 255);
  return (r << 16) | (g << 8) | b;
}

/** One on-field Pokémon's complete visual presentation: body sprite, HP bar,
 * status icon, and transient move-name callout. Reads from a PokemonInstance
 * snapshot each frame; owns no simulation state itself. */
export class PokemonSprite {
  readonly instanceId: string;

  private readonly scene: Phaser.Scene;
  private readonly speciesId: number;
  private readonly shiny: boolean;
  /** Boss Mode's boss renders at BOSS_CONFIG.spriteScaleMultiplier — applied
   * on top of the normal per-species scale wherever that's computed. */
  private readonly isBoss: boolean;
  /** This species' on-screen target size (px, longest side), read straight
   * off pokemon.collisionRadius rather than recomputed independently — see
   * tryLoadPmdSprites() below. matchSetup.ts's buildInstance already bakes
   * BOSS_CONFIG.spriteScaleMultiplier into a boss's own collisionRadius, so
   * this is correctly boss-scaled too without needing to reapply it here. */
  private readonly targetOnScreenSize: number;
  /** True only once real shiny PMD art (a genuine per-species recolor, not a
   * tint) is actually loaded — see tryLoadPmdSprites(). Also folded into the
   * PMD texture/anim key names, so a species played once normally and once
   * shiny in the same session never reuses the wrong cached texture. */
  private usingRealShinyArt = false;
  private readonly container: Phaser.GameObjects.Container;
  private readonly placeholder: Phaser.GameObjects.Arc;
  private body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  /** The status callout under the Pokémon (see buildStatusBox), or null while healthy. */
  private statusBox: Phaser.GameObjects.Container | null = null;
  /** pokemon.status as of the last update() — what statusBox and the body
   * tint currently reflect (see updateStatusBox / applyBodyTint). */
  private shownStatus: StatusCondition | null = null;
  private moveLabel: Phaser.GameObjects.Container | null = null;

  private frontIsAnimated = false;
  private backIsAnimated = false;
  private lastSeenHitAtMs = 0;
  private isShowingBack = false;
  private hasFainted = false;
  private idleTween: Phaser.Tweens.Tween | null = null;

  private isHighlighted = false;
  /** Team Mode's side color (see ui/teamColors.ts), or undefined outside Team
   * Mode — drawn as a glow ring like the highlight, but only when there's no
   * highlight to show instead (see applyHighlightEffect()). */
  private teamGlowColor: number | undefined;

  private isPmdTier = false;
  /** Only the actions that actually finished loading (a subset of the index entry's). */
  private pmdActions: Record<string, PmdAnimEntry> = {};
  private pmdScale = 1;
  private pendingOneShot: string | null = null;
  /** Facing locked in for the duration of the current one-shot action, so the
   * sim's own (movement-driven) facing can't yank the animation to a
   * different row mid-playback — see triggerPmdOneShot(). */
  private oneShotFacing: FacingDirection | null = null;
  private lastFacing: FacingDirection = 'S';
  /** Facing locked in once for the whole post-attack hold window (see
   * desiredFacing() below) — captured the one sim tick the move actually
   * fires, then held fixed rather than recomputed every frame. */
  private heldAttackFacing: FacingDirection | null = null;

  private hasRevealed = false;
  private pokeball: Phaser.GameObjects.Image | null = null;
  private renderPos: Vec2;
  /** Purely cosmetic, additive offset from renderPos — a move animation's
   * own instructions for this battler's sprite (a Tackle's dash into the
   * target, a Growl's recoil), see setAnimOffset(). Never fed back into
   * the sim; PokemonInstance.position stays the sole source of truth, per
   * ArenaScene's "renderer never mutates simulation state" invariant. */
  private readonly animOffset: Vec2 = { x: 0, y: 0 };
  /** The tween currently driving animOffset on this sprite's own behalf (a
   * lunge dash or a dodge) — stopped whenever something newer takes over
   * the offset, so motions never stack. */
  private offsetTween: Phaser.Tweens.TweenChain | null = null;
  private pendingDodge: Phaser.Time.TimerEvent | null = null;
  /** The status animation currently playing on this sprite, if any — see
   * playStatusAnimation(). */
  private statusAnimation: AnimationHandle | null = null;
  /** When set, update() stops folding the sim's live position into renderPos
   * — see lockPosition(). Its own attack cooldown clears (and the sim starts
   * wandering it off again) almost immediately after a move fires, well
   * before the render's attack visual window (ArenaScene's
   * ATTACK_VISUAL_DURATION_MS) closes, so without this a ranged attacker
   * visibly drifts away mid-pose. Purely cosmetic, like animOffset — never
   * fed back into the sim. */
  private positionLockToken: symbol | null = null;

  /** Repeating spawner for the current status's ambient VFX — see
   * updateStatusVfx(). Null whenever the Pokémon is healthy. */
  private statusVfxTimer: Phaser.Time.TimerEvent | null = null;
  private statusVfxFor: StatusCondition | null = null;

  /** Continuous twinkle for a shiny Pokémon (see createShinyAura), started
   * once at reveal and left running — parented to `container` so it tracks
   * position for free — until this sprite is destroyed. Null for a
   * non-shiny Pokémon. */
  private shinyAura: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  /**
   * `spawnIndex`/`totalCount` drive the clockwise Pokéball-drop entrance —
   * matchSetup.ts's circlePosition already assigns spawn indices in clockwise
   * order starting from the top, so index order alone gives the right
   * sequence; this sprite just staggers its own reveal by that index.
   */
  constructor(
    scene: Phaser.Scene,
    pokemon: PokemonInstance,
    spriteIndex: SpriteIndex | null,
    pmdSpriteIndex: PmdSpriteIndex | null,
    spawnIndex: number,
    shiny: boolean
  ) {
    this.scene = scene;
    this.instanceId = pokemon.instanceId;
    this.speciesId = pokemon.speciesId;
    this.shiny = shiny;
    this.isBoss = !!pokemon.isBoss;
    this.targetOnScreenSize = pokemon.collisionRadius / COLLISION_RADIUS_FACTOR;
    this.renderPos = { x: pokemon.position.x, y: pokemon.position.y };

    this.container = scene.add.container(pokemon.position.x, pokemon.position.y - BALL_DROP_HEIGHT);
    this.container.setDepth(pokemon.position.y);
    // Nothing (not even the Pokéball) shows until this Pokémon's own staggered
    // turn comes up — otherwise every ball is visible from t=0, sitting in a
    // static row above the arena for its whole wait, which reads as a
    // pre-rendered/uneven "waiting in line" look rather than a clockwise drop.
    this.container.setVisible(false);

    this.placeholder = scene.add.circle(0, 0, PLACEHOLDER_RADIUS, 0xcccccc).setStrokeStyle(2, 0x888888);
    this.placeholder.setVisible(false);
    this.container.add(this.placeholder);

    // Y position is corrected every frame in updateHpBar() once a body
    // exists — placed at 0 here since sprite sizes vary too much (64-150px
    // for PMD tier) for a fixed offset to sit at everyone's feet.
    this.hpBarBg = scene.add
      .rectangle(0, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x1a1a1a, 0.85)
      .setOrigin(0.5, 0.5);
    this.hpBarFill = scene.add
      .rectangle(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT - 1.5, 0x4caf50)
      .setOrigin(0, 0.5);
    this.hpBarBg.setVisible(false);
    this.hpBarFill.setVisible(false);
    this.container.add([this.hpBarBg, this.hpBarFill]);

    this.pokeball = scene.add.image(0, 0, POKEBALL_TEXTURE_KEY);
    this.pokeball.setDisplaySize(POKEBALL_ICON_SIZE, POKEBALL_ICON_SIZE);
    this.container.add(this.pokeball);

    // Kick off sprite loading immediately (in parallel with the drop
    // animation) so the real art is often already in hand by the time the
    // ball pops open — no separate "loading" flash.
    void this.loadSprites(pokemon, spriteIndex, pmdSpriteIndex);

    const jitter = Phaser.Math.Between(-BALL_STAGGER_JITTER_MS, BALL_STAGGER_JITTER_MS);
    const delay = Math.max(0, spawnIndex * BALL_DROP_STAGGER_MS + jitter);
    scene.time.delayedCall(delay, () => this.playEntrance(pokemon.position));
  }

  /** Marks this as the current multiplayer player's own pick — adds a slight
   * glow outline so it's easy to spot among the roster. Safe to call before
   * the body sprite has finished loading; the effect is reapplied whenever a
   * new body GameObject is created (see onPmdSpritesReady/onSpritesReady) —
   * a texture/tier swap on the same GameObject keeps it automatically. */
  setHighlighted(highlighted: boolean): void {
    this.isHighlighted = highlighted;
    this.applyHighlightEffect();
  }

  /** Marks which Team Mode side this Pokémon is on — pass undefined outside
   * Team Mode. Safe to call before the body sprite has finished loading, same
   * as setHighlighted(). */
  setTeamColor(colorHex: number | undefined): void {
    this.teamGlowColor = colorHex;
    this.applyHighlightEffect();
  }

  private applyHighlightEffect(): void {
    if (!(this.body instanceof Phaser.GameObjects.Sprite || this.body instanceof Phaser.GameObjects.Image)) return;
    this.body.postFX.clear();
    // The multiplayer "this is your own pick" highlight takes priority over
    // the team ring when both would apply — it's the more specific, more
    // useful-in-the-moment signal — rather than trying to render two glows.
    const glowColor = this.isHighlighted ? HIGHLIGHT_GLOW_COLOR : this.teamGlowColor;
    if (glowColor !== undefined) {
      this.body.postFX.addGlow(glowColor, HIGHLIGHT_GLOW_OUTER_STRENGTH, 0, false, HIGHLIGHT_GLOW_QUALITY, HIGHLIGHT_GLOW_DISTANCE);
    }
  }

  private playEntrance(targetPos: Vec2): void {
    if (this.container.scene === undefined) return; // destroyed before its turn came up
    this.container.setVisible(true);
    this.scene.tweens.add({
      targets: this.container,
      y: targetPos.y,
      duration: BALL_DROP_DURATION_MS,
      ease: 'Bounce.easeOut',
      onComplete: () => this.completeEntrance(targetPos),
    });
  }

  private completeEntrance(targetPos: Vec2): void {
    if (this.container.scene === undefined) return;
    this.renderPos = { x: targetPos.x, y: targetPos.y };
    this.pokeball?.destroy();
    this.pokeball = null;

    this.placeholder.setVisible(this.body === null);
    this.body?.setVisible(true);
    this.hpBarBg.setVisible(true);
    this.hpBarFill.setVisible(true);
    this.hasRevealed = true;
    playCry(this.scene, this.speciesId);
    playSparkleReveal(this.scene, targetPos.x, targetPos.y, this.shiny);
    if (this.shiny) {
      this.shinyAura = createShinyAura(this.scene, this.targetOnScreenSize);
      this.container.add(this.shinyAura);
    }

    this.container.setScale(0.5);
    this.scene.tweens.add({
      targets: this.container,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });
  }

  private async loadSprites(
    pokemon: PokemonInstance,
    spriteIndex: SpriteIndex | null,
    pmdSpriteIndex: PmdSpriteIndex | null
  ): Promise<void> {
    const pmdEntry = pmdSpriteIndex?.[String(pokemon.speciesId)];
    if (pmdEntry) {
      const loaded = await this.tryLoadPmdSprites(pmdEntry);
      if (loaded) return;
      // Committed index says this species has PMD sprites, but a file failed
      // to actually load — fall through to the hotlink tier below rather
      // than leaving a placeholder.
    }
    const initial = resolveSpriteUrls(pokemon.speciesId, pokemon.name, spriteIndex);
    await this.tryLoadTier(pokemon, initial);
  }

  private pmdTextureKey(action: string): string {
    return `poke-${this.speciesId}-pmd-${action}${this.usingRealShinyArt ? '-shiny' : ''}`;
  }

  private pmdAnimKey(action: string, row: number): string {
    return `poke-${this.speciesId}-pmd-${action}${this.usingRealShinyArt ? '-shiny' : ''}-r${row}`;
  }

  private async tryLoadPmdSprites(entry: PmdSpriteIndex[string]): Promise<boolean> {
    if (!entry.actions.Idle || !entry.actions.Walk) return false; // defensive re-check of the pipeline's own gate

    // Real shiny art (a genuine per-species recolor) takes priority over the
    // flat-tint fallback whenever PMDCollab actually has it for this species.
    this.usingRealShinyArt = this.shiny && !!entry.shiny;
    const dir = this.usingRealShinyArt ? entry.shiny!.dir : entry.dir;
    const sourceActions = this.usingRealShinyArt ? entry.shiny!.actions : entry.actions;
    // Per-species cache tag (see pmdSheetUrl.ts): an updated species gets
    // new URLs without invalidating every other species' cached sheets.
    const version = this.usingRealShinyArt ? entry.shiny!.version : entry.version;

    const loaded: Record<string, PmdAnimEntry> = {};
    await Promise.all(
      Object.entries(sourceActions).map(async ([action, meta]) => {
        const key = this.pmdTextureKey(action);
        const ok = await this.loadSpriteSheet(key, pmdSheetUrl(dir, action, version), {
          frameWidth: meta.frameWidth,
          frameHeight: meta.frameHeight,
        });
        if (ok) loaded[action] = meta;
      })
    );
    if (!loaded.Idle || !loaded.Walk) return false; // a required action failed to actually load

    for (const action of Object.keys(loaded)) {
      this.scene.textures.get(this.pmdTextureKey(action)).setFilter(Phaser.Textures.FilterMode.NEAREST);
      this.registerPmdAnimations(action, loaded[action]);
    }
    this.pmdActions = loaded;
    this.isPmdTier = true;
    // The texture scale that puts the visible body at targetOnScreenSize
    // (already correctly boss-scaled, see that field's own comment): divide
    // by the same measured body the sim sized it from, never by the sheet's
    // frame canvas, whose padding varies per species (see
    // computeOnScreenSizeFromBody). The frame is only a last resort for a
    // species the measurement somehow missed — the sim then estimated its
    // size from real height, so nothing better is available here either.
    const nativeSize = getPmdBodySize(this.speciesId) ?? Math.max(loaded.Idle.frameWidth, loaded.Idle.frameHeight, 1);
    this.pmdScale = this.targetOnScreenSize / nativeSize;
    this.onPmdSpritesReady();
    return true;
  }

  private async loadSpriteSheet(
    key: string,
    url: string,
    frameConfig: { frameWidth: number; frameHeight: number }
  ): Promise<boolean> {
    if (this.scene.textures.exists(key)) return true; // dedup across same-species instances
    return new Promise((resolve) => {
      // Same persistent-listener reasoning as loadStaticImage() below —
      // 'loaderror' is generic across the shared loader.
      const onError = (file: { key: string }): void => {
        if (file.key === key) finish(false);
      };
      const onComplete = (): void => finish(true);
      const finish = (ok: boolean): void => {
        this.scene.load.off(`filecomplete-spritesheet-${key}`, onComplete);
        this.scene.load.off('loaderror', onError);
        resolve(ok);
      };

      this.scene.load.spritesheet(key, url, frameConfig);
      this.scene.load.once(`filecomplete-spritesheet-${key}`, onComplete);
      this.scene.load.on('loaderror', onError);
      if (!this.scene.load.isLoading()) this.scene.load.start();
    });
  }

  private registerPmdAnimations(action: string, meta: PmdAnimEntry): void {
    const textureKey = this.pmdTextureKey(action);
    const frameCount = meta.durationsMs.length;
    const isOneShot = ONE_SHOT_PMD_ACTIONS.has(action);
    for (let row = 0; row < meta.directions; row++) {
      const animKey = this.pmdAnimKey(action, row);
      if (this.scene.anims.exists(animKey)) continue; // shared/reused across same-species instances
      this.scene.anims.create({
        key: animKey,
        frames: Array.from({ length: frameCount }, (_, i) => ({
          key: textureKey,
          frame: row * frameCount + i,
          duration: meta.durationsMs[i],
        })),
        repeat: isOneShot ? 0 : -1,
      });
    }
  }

  private onPmdSpritesReady(): void {
    if (this.container.scene === undefined) return; // destroyed while loading
    this.placeholder.setVisible(false);

    const sprite = this.scene.add.sprite(0, 0, this.pmdTextureKey('Idle')).setOrigin(0.5, 0.75);
    sprite.setScale(this.pmdScale);
    sprite.setVisible(this.hasRevealed); // stays hidden under the Pokéball until it pops open
    this.container.addAt(sprite, 0);
    this.body = sprite;
    this.applyBodyTint();
    // No synthetic idle-bob tween here — PMD's own Idle animation already has
    // baked motion; adding the old hotlink-tier tween on top would double it.
    sprite.play(this.pmdAnimKey('Idle', FACING_TO_ROW.S));
    this.applyHighlightEffect();
  }

  private async tryLoadTier(pokemon: PokemonInstance, urls: SpriteUrls): Promise<void> {
    const frontKey = `poke-${pokemon.speciesId}-front-${urls.tier}`;
    const backKey = `poke-${pokemon.speciesId}-back-${urls.tier}`;

    if (urls.isAnimated) {
      const [frontResult, backResult] = await Promise.all([
        loadGifAsAnimatedTexture(this.scene, urls.front, frontKey),
        loadGifAsAnimatedTexture(this.scene, urls.back, backKey),
      ]);
      if (!frontResult || !backResult) {
        this.downgradeAndRetry(pokemon, urls.tier);
        return;
      }
      this.frontIsAnimated = true;
      this.backIsAnimated = true;
      this.onSpritesReady(frontKey, backKey);
      return;
    }

    const [frontOk, backOk] = await Promise.all([
      this.loadStaticImage(frontKey, urls.front),
      this.loadStaticImage(backKey, urls.back),
    ]);
    if (!frontOk || !backOk) {
      this.downgradeAndRetry(pokemon, urls.tier);
      return;
    }
    this.frontIsAnimated = false;
    this.backIsAnimated = false;
    this.onSpritesReady(frontKey, backKey);
  }

  private downgradeAndRetry(pokemon: PokemonInstance, failedTier: SpriteUrls['tier']): void {
    const next = downgradeTier(failedTier);
    if (!next) return; // exhausted the fallback chain — keep the placeholder circle
    const urls = resolveSpriteUrls(pokemon.speciesId, pokemon.name, null, next);
    void this.tryLoadTier(pokemon, urls);
  }

  private async loadStaticImage(key: string, url: string): Promise<boolean> {
    if (this.scene.textures.exists(key)) return true;
    await acquireSpriteSlot();
    return new Promise((resolve) => {
      // Phaser has no per-file error event (unlike `filecomplete-image-{key}`
      // for success) — 'loaderror' fires generically for every failed file in
      // the shared loader, so with many Pokémon loading concurrently this
      // MUST be a persistent `.on()` + manual filter-and-remove, not
      // `.once()`: a `.once()` listener consumes itself on the very first
      // loaderror it sees even when that error belongs to a different
      // Pokémon's sprite, silently orphaning this call's Promise forever and
      // gating the entire fallback chain from ever reaching the next tier.
      const onError = (file: { key: string }): void => {
        if (file.key === key) finish(false);
      };
      const onComplete = (): void => finish(true);
      const finish = (ok: boolean): void => {
        this.scene.load.off(`filecomplete-image-${key}`, onComplete);
        this.scene.load.off('loaderror', onError);
        releaseSpriteSlot();
        resolve(ok);
      };

      this.scene.load.image(key, url);
      this.scene.load.once(`filecomplete-image-${key}`, onComplete);
      this.scene.load.on('loaderror', onError);
      if (!this.scene.load.isLoading()) this.scene.load.start();
    });
  }

  private onSpritesReady(frontKey: string, backKey: string): void {
    if (this.container.scene === undefined) return; // destroyed while loading
    this.placeholder.setVisible(false);

    const sprite = this.scene.add.sprite(0, 0, frontKey).setOrigin(0.5, 0.7);
    sprite.setData('frontKey', frontKey);
    sprite.setData('backKey', backKey);
    const scale = (TARGET_SPRITE_SIZE / Math.max(sprite.width, sprite.height, 1)) * (this.isBoss ? BOSS_CONFIG.spriteScaleMultiplier : 1);
    sprite.setScale(scale);
    sprite.setVisible(this.hasRevealed); // stays hidden under the Pokéball until it pops open
    this.container.addAt(sprite, 0);
    this.body = sprite;
    this.applyBodyTint();

    if (this.frontIsAnimated) {
      sprite.play(frontKey);
    } else {
      this.idleTween = this.scene.tweens.add({
        targets: sprite,
        y: -3,
        duration: 550,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    this.applyHighlightEffect();
  }

  update(
    pokemon: PokemonInstance,
    screenX: number,
    screenY: number,
    nowMs: number,
    allPokemon: Record<string, PokemonInstance>
  ): void {
    if (!this.hasRevealed) return; // entrance tween owns position/visibility until it lands

    if (this.positionLockToken === null) {
      let stepX = (screenX - this.renderPos.x) * POSITION_SMOOTHING;
      let stepY = (screenY - this.renderPos.y) * POSITION_SMOOTHING;
      const stepDist = Math.hypot(stepX, stepY);
      if (stepDist > MAX_POSITION_STEP_PER_FRAME) {
        const scale = MAX_POSITION_STEP_PER_FRAME / stepDist;
        stepX *= scale;
        stepY *= scale;
      }
      this.renderPos.x += stepX;
      this.renderPos.y += stepY;
    }
    this.container.setPosition(this.renderPos.x + this.animOffset.x, this.renderPos.y + this.animOffset.y);
    this.container.setDepth(this.renderPos.y + this.animOffset.y);

    this.updateFacing(pokemon, allPokemon, nowMs);
    this.updateHpBar(pokemon);
    this.updateStatusBox(pokemon);
    this.updateStatusVfx(pokemon);
    this.updateHitFlash(pokemon, nowMs, allPokemon);
  }

  /** The sim's own `facing` field is movement-driven and only updates while a
   * Pokémon is actually translating (see applyMovement/movement.ts) — but the
   * 'attack' AI state holds position via separation only, never moving
   * toward its target, so `pokemon.facing` is just whatever was left over
   * from the last time it was chasing. Left alone, that produces exactly the
   * "turns to attack, then snaps back to a stale direction" glitch: the
   * one-shot swing correctly faces the target (see triggerPmdOneShot's
   * caller in ArenaScene), but the moment it ends, rendering would fall back
   * to the stale sim facing. So while actively engaged, face the target
   * instead; movement states keep using the sim's facing, since there it's
   * already correct (and is what makes walking look right).
   *
   * `aiState` alone isn't a wide enough window, though: it only reads
   * 'attack' for the single ~50ms sim tick the move actually fires on —
   * updateTargeting (ai.ts) forces it back to 'wander' the very next tick
   * while actionCooldownMs is still counting down, well before the attack's
   * on-screen pose/hold has actually finished playing (ATTACK_VISUAL_DURATION_MS
   * in ArenaScene, deliberately kept equal to postAttackHoldMs below — see
   * POST_ATTACK_HOLD_MS's own comment). This needs to keep facing the target
   * for that whole window too, or the sprite snaps to the stale
   * pokemon.facing partway through its own attack animation instead of at
   * the end of it.
   *
   * Critically, though, that target-facing is computed *once* (on the
   * 'attack' tick itself) and held fixed via heldAttackFacing for the rest of
   * the hold — not recomputed live every frame. Both combatants can still be
   * getting nudged by separation from other crowding neighbors during a
   * hold-still window (that's the one force stepMovement still allows there),
   * so the raw angle between them is noisier than it looks for something
   * that's supposedly standing still — recomputing it every frame let that
   * jitter walk the facing back and forth across an 8-way sector boundary
   * repeatedly over the ~1.2s hold. For an 8-direction PMD sprite that's
   * flickering between entirely different drawn rows several times a
   * second — most obvious on a large, visually asymmetric species (a
   * legendary like Rayquaza reads as "spinning" far more than a small,
   * roughly-symmetric one does) — and for a species without full PMD art,
   * whose facing fallback fakes diagonals by rotating a single sprite image
   * (FACING_CONFIG's tiltDeg) instead, it's a literal spin either way.
   * targetInstanceId stays pointed at whoever was just attacked for this
   * whole window (nothing reassigns it while actionCooldownMs > 0), so it's
   * safe to read once and trust for the duration. */
  private desiredFacing(pokemon: PokemonInstance, allPokemon: Record<string, PokemonInstance>, nowMs: number): FacingDirection {
    if (pokemon.aiState === 'attack' && pokemon.targetInstanceId) {
      const target = allPokemon[pokemon.targetInstanceId];
      if (target) this.heldAttackFacing = this.facingToward(pokemon.position, target.position);
    }
    if (pokemon.postAttackHoldMs > 0) {
      // The same hold also pins a Pokémon that was just *hit* (see
      // engine.ts's executeMove). One that was wandering when it got hit has
      // no attack facing to hold, so it would stand there facing wherever
      // it was walking — turn it toward whoever hit it instead, computed
      // once for the same anti-jitter reason as above.
      if (!this.heldAttackFacing && pokemon.lastHitAtMs !== undefined && nowMs - pokemon.lastHitAtMs <= POST_ATTACK_HOLD_MS) {
        this.heldAttackFacing = this.computeHitFacing(pokemon, allPokemon);
      }
      if (this.heldAttackFacing) return this.heldAttackFacing;
    }
    this.heldAttackFacing = null;
    return pokemon.facing;
  }

  private updateFacing(pokemon: PokemonInstance, allPokemon: Record<string, PokemonInstance>, nowMs: number): void {
    if (!this.body) return;
    const facing = this.desiredFacing(pokemon, allPokemon, nowMs);
    this.lastFacing = facing;

    if (this.isPmdTier) {
      this.updatePmdAnimationState(pokemon, facing);
      return;
    }

    const config = FACING_CONFIG[facing];

    if (config.useBack !== this.isShowingBack || this.body.texture.key === '') {
      const key = config.useBack ? this.body.getData('backKey') : this.body.getData('frontKey');
      const isAnimated = config.useBack ? this.backIsAnimated : this.frontIsAnimated;
      if (this.body instanceof Phaser.GameObjects.Sprite) {
        this.body.setTexture(key);
        if (isAnimated) this.body.play({ key, repeat: -1 }, true);
      }
      this.isShowingBack = config.useBack;
    }

    this.body.setFlipX(config.flip);
    this.body.setAngle(config.tiltDeg);
    this.applyFrozenPause(pokemon.status === 'freeze');
  }

  private desiredPmdAction(pokemon: PokemonInstance): string {
    if (pokemon.status === 'sleep' && this.pmdActions.Sleep) return 'Sleep';
    const wantsWalk = pokemon.aiState === 'wander' || pokemon.aiState === 'chase';
    return wantsWalk && this.pmdActions.Walk ? 'Walk' : 'Idle';
  }

  private updatePmdAnimationState(pokemon: PokemonInstance, desiredFacing: FacingDirection): void {
    if (!(this.body instanceof Phaser.GameObjects.Sprite)) return;
    const action = this.pendingOneShot ?? this.desiredPmdAction(pokemon);
    const meta = this.pmdActions[action];
    if (!meta) return;
    // While a one-shot is playing, its facing was locked in when it was
    // triggered (e.g. facing the attacker for Hurt) — keep using that rather
    // than the live desired facing, or a mid-swing direction change would
    // yank the animation to a different row every frame.
    const facing = this.pendingOneShot ? (this.oneShotFacing ?? desiredFacing) : desiredFacing;
    const row = meta.directions === 8 ? FACING_TO_ROW[facing] : 0;
    const key = this.pmdAnimKey(action, row);
    // A frozen Pokémon's looping animation is held on its current frame (see
    // applyFrozenPause) — and Phaser counts a paused animation as not
    // playing, so the ignoreIfPlaying check below would restart it from
    // frame 0 every frame instead of leaving it held.
    const frozenStill = pokemon.status === 'freeze' && !this.pendingOneShot;
    if (frozenStill && this.body.anims.isPaused && this.body.anims.currentAnim?.key === key) return;
    // ignoreIfPlaying=true: no-ops if this exact key (same action AND
    // direction) is already current, so only a genuine action/facing change
    // restarts the animation from frame 0.
    this.body.play(key, true);
    this.applyFrozenPause(frozenStill);
  }

  /** Fires a one-shot PMD action (Attack/Hurt/Faint), then lets the looping
   * Idle/Walk state resume once it completes. No-op for non-PMD-tier sprites
   * or actions this species doesn't have. `facing` defaults to the sprite's
   * last-known facing (e.g. for Attack); Hurt overrides it to face the hit's
   * source instead. */
  private triggerPmdOneShot(action: string, facing: FacingDirection = this.lastFacing): void {
    if (!this.isPmdTier || !this.pmdActions[action] || !(this.body instanceof Phaser.GameObjects.Sprite)) return;
    this.pendingOneShot = action;
    this.oneShotFacing = facing;
    const meta = this.pmdActions[action];
    const row = meta.directions === 8 ? FACING_TO_ROW[facing] : 0;
    const key = this.pmdAnimKey(action, row);
    this.body.play(key, true);
    this.body.once(`animationcomplete-${key}`, () => {
      if (this.pendingOneShot === action) {
        this.pendingOneShot = null;
        this.oneShotFacing = null;
      }
    });
  }

  /** Direction from `from` toward `to`, bucketed with the same 8-way logic
   * the sim uses for movement facing. The sim's own `facing` field is
   * movement-driven and goes stale the moment a Pokémon stops actually
   * moving — in particular the 'attack' AI state holds position via
   * separation only (see movement.ts), never turning toward its target, so
   * relying on `pokemon.facing` for an attack/hurt reaction can point the
   * wrong way as soon as the target has shifted since the attacker last
   * chased. Computing it fresh from current positions instead is correct
   * regardless of how stale the movement-facing is. */
  private facingToward(from: Vec2, to: Vec2): FacingDirection {
    return velocityToFacing({ x: to.x - from.x, y: to.y - from.y }, this.lastFacing);
  }

  /** Called by ArenaScene on a 'moveUsed' event for the attacker — faces the
   * attacker toward its actual current target before playing the swing.
   * `ranged` (true for every move family except lunge — see the caller) picks
   * this species' dedicated ranged-attack pose over the generic melee-swing
   * Attack frame, where it has one. */
  playPmdAttack(selfPosition: Vec2, targetPosition: Vec2 | undefined, ranged: boolean): void {
    const facing = targetPosition ? this.facingToward(selfPosition, targetPosition) : this.lastFacing;
    const action = ranged ? this.resolveRangedAttackAction() : 'Attack';
    this.triggerPmdOneShot(action, facing);
  }

  private resolveRangedAttackAction(): string {
    return RANGED_ATTACK_ACTION_PRIORITY.find((action) => this.pmdActions[action]) ?? 'Attack';
  }

  /** Freezes this sprite's on-screen position (see positionLockToken) for the
   * caller's attack visual window. Returns a function that releases the
   * lock; safe to call even after a newer lockPosition() has superseded it
   * (e.g. this attacker fires again before its first attack's visual window
   * closes) — it only clears the lock if it's still the one this call set. */
  lockPosition(): () => void {
    const token = Symbol();
    this.positionLockToken = token;
    return () => {
      if (this.positionLockToken === token) this.positionLockToken = null;
    };
  }

  /** Jumps the smoothed render position straight to the sim's — for a frame
   * gap too large to glide across (a tab back from the background, see
   * ArenaScene's SNAP_TO_SIM_AFTER_MS). Deliberately overrides a position
   * lock: an attack visual that was in progress when the frames stopped is
   * stale by now, and holding its attacker where it stood before the gap
   * just means a long glide once the lock releases. */
  snapToSimPosition(position: Vec2): void {
    if (!this.hasRevealed) return;
    this.renderPos.x = position.x;
    this.renderPos.y = position.y;
  }

  /** Where this sprite is currently drawn (its smoothed render position,
   * before any animation offset) — the live anchor a move animation tracks
   * so a projectile follows a target that keeps walking (see
   * AnimPlayer.ts). Returns a fresh object each call. */
  getRenderPosition(): Vec2 {
    return { x: this.renderPos.x, y: this.renderPos.y };
  }

  /** How far above renderPos the body's visual center sits (px). The body's
   * origin is at 0.75 of its height (feet near renderPos), so the center is
   * a quarter of the body up; 0 before the body exists. */
  bodyCenterLift(): number {
    return this.body ? this.body.displayHeight * (this.body.originY - 0.5) : 0;
  }

  /** Where a move animation's battler spot lands on this sprite: the body's
   * visual center. The pack draws its battlers centered on the user/target
   * spots (Bite's cells sit exactly on the target spot — see
   * moveAnimationFormat.ts), while renderPos is near the feet, so anchoring
   * on renderPos put every impact a quarter of a body too low. Depth-sort
   * against getRenderPosition().y, not this (see geometry.ts's AnimDepths). */
  getAnimAnchor(): Vec2 {
    return { x: this.renderPos.x, y: this.renderPos.y - this.bodyCenterLift() };
  }

  /** This species' on-screen size (px, longest side) — what a move
   * animation scales itself by relative to the battlers it was drawn
   * around (see ANIM_REFERENCE_BATTLER_SIZE). */
  getOnScreenSize(): number {
    return this.targetOnScreenSize;
  }

  /** True once destroy() has run (fainted and faded out) — a move animation
   * that outlives its target keeps drawing at the target's last position
   * rather than reading a dead sprite. */
  isDestroyed(): boolean {
    return this.container.scene === undefined;
  }

  /** A move animation's per-frame displacement for this battler's sprite
   * (see AnimPlayer.ts's AnimBattler) — purely additive and cosmetic, see
   * animOffset. Reset to (0, 0) by the animation when it ends or is cut off. */
  setAnimOffset(x: number, y: number): void {
    if (this.isDestroyed()) return;
    this.offsetTween?.stop();
    this.offsetTween = null;
    this.animOffset.x = x;
    this.animOffset.y = y;
  }

  /** The reaction to a move that missed this Pokémon: after `delayMs` (the
   * attack's flight time, so the effect visibly lands where it stood) it
   * hops across the line of attack from `attackerPosition`, pops a "MISS"
   * callout, holds a beat, and steps back. Purely cosmetic via animOffset,
   * like a lunge; a newer offset motion cancels it. */
  playDodge(attackerPosition: Vec2, delayMs: number): void {
    if (this.isDestroyed()) return;
    this.pendingDodge?.remove();
    this.pendingDodge = this.scene.time.delayedCall(delayMs, () => {
      this.pendingDodge = null;
      if (this.isDestroyed()) return;
      const dx = this.renderPos.x - attackerPosition.x;
      const dy = this.renderPos.y - attackerPosition.y;
      const distance = Math.hypot(dx, dy);
      // Across the line of attack; the side is a coin flip so repeated
      // dodges don't always go the same way.
      const side = Math.random() < 0.5 ? -1 : 1;
      const perpX = distance > 0 ? (-dy / distance) * side : side;
      const perpY = distance > 0 ? (dx / distance) * side : 0;
      const hop = Phaser.Math.Clamp(this.targetOnScreenSize * DODGE_DISTANCE_FACTOR, DODGE_MIN_PX, DODGE_MAX_PX);

      this.showMissCallout();
      this.offsetTween?.stop();
      this.offsetTween = this.scene.tweens.chain({
        targets: this.animOffset,
        tweens: [
          { x: perpX * hop, y: perpY * hop, duration: DODGE_OUT_MS, ease: 'Quad.easeOut' },
          { x: 0, y: 0, duration: DODGE_BACK_MS, delay: DODGE_HOLD_MS, ease: 'Quad.easeIn' },
        ],
      });
    });
  }

  /** "MISS" popping up above the body and drifting away, in the move
   * label's pixel font — the tell that the attack that just played
   * connected with nothing. */
  private showMissCallout(): void {
    const startY = this.topOfBodyY() - 4;
    const text = this.scene.add
      .text(0, startY, 'MISS', {
        fontSize: `${MISS_CALLOUT_FONT_SIZE}px`,
        fontFamily: MOVE_LABEL_FONT_FAMILY,
        color: '#ffffff',
        stroke: '#1a1a1a',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setScale(0.5)
      .setAlpha(0.95);
    this.container.add(text);
    this.scene.tweens.add({ targets: text, scale: 1, duration: MISS_CALLOUT_POP_MS, ease: 'Back.easeOut' });
    this.scene.tweens.add({
      targets: text,
      y: startY - MISS_CALLOUT_RISE_PX,
      duration: MISS_CALLOUT_LIFESPAN_MS,
      ease: 'Sine.easeOut',
      onComplete: () => text.destroy(),
    });
    this.scene.tweens.add({
      targets: text,
      alpha: 0,
      delay: MISS_CALLOUT_LIFESPAN_MS * 0.5,
      duration: MISS_CALLOUT_LIFESPAN_MS * 0.5,
    });
  }

  /** The arena's own lunge-family VFX (see moves/playFamilyVfx.ts, used for
   * the moves whose pack animation is screen-wide) — dashes this sprite
   * toward `targetPosition` and back via the same additive animOffset a
   * pack animation drives. Distance is clamped so the attacker stops just
   * short of the target's own footprint rather than overlapping it. Kills
   * any lunge already in flight first so a fast attacker's consecutive
   * hits retarget smoothly instead of stacking offsets. `onImpact` fires
   * at the apex, for the caller's contact VFX. */
  playLungeAttack(selfPosition: Vec2, targetPosition: Vec2, targetCollisionRadius: number, onImpact?: () => void): void {
    this.offsetTween?.stop();

    const dx = targetPosition.x - selfPosition.x;
    const dy = targetPosition.y - selfPosition.y;
    const distanceToTarget = Math.hypot(dx, dy);
    const travel = Phaser.Math.Clamp(distanceToTarget - targetCollisionRadius, 0, MAX_LUNGE_DISTANCE);
    const dirX = distanceToTarget > 0 ? dx / distanceToTarget : 0;
    const dirY = distanceToTarget > 0 ? dy / distanceToTarget : 0;

    this.offsetTween = this.scene.tweens.chain({
      targets: this.animOffset,
      tweens: [
        {
          x: dirX * travel,
          y: dirY * travel,
          duration: LUNGE_OUT_MS,
          ease: 'Quad.easeOut',
          onComplete: () => onImpact?.(),
        },
        { x: 0, y: 0, duration: LUNGE_BACK_MS, ease: 'Quad.easeIn' },
      ],
    });
  }

  /** A move animation hiding or fading this battler's body (Fly's ascent,
   * Explosion's self-KO, a Double Team flicker). Only the body: the HP bar
   * and labels stay put. Reset to 1 by the animation when it ends. */
  setAnimAlpha(alpha: number): void {
    if (this.isDestroyed() || !this.body) return;
    this.body.setAlpha(alpha);
  }

  /** Direction from the defender toward whoever last hit it — i.e. the
   * direction the hit came from. Falls back to the sprite's current facing
   * if the attacker can't be resolved (e.g. it fainted the same tick). */
  private computeHitFacing(pokemon: PokemonInstance, allPokemon: Record<string, PokemonInstance>): FacingDirection {
    const attacker = pokemon.lastDamagedByInstanceId ? allPokemon[pokemon.lastDamagedByInstanceId] : undefined;
    if (!attacker) return this.lastFacing;
    return this.facingToward(pokemon.position, attacker.position);
  }

  private updateHpBar(pokemon: PokemonInstance): void {
    const y = this.bottomOfBodyY() + HP_BAR_GAP;
    this.hpBarBg.y = y;
    this.hpBarFill.y = y;

    const ratio = pokemon.maxHp > 0 ? Math.max(0, pokemon.currentHp / pokemon.maxHp) : 0;
    this.hpBarFill.width = HP_BAR_WIDTH * ratio;
    this.hpBarFill.fillColor = ratio > 0.5 ? 0x4caf50 : ratio > 0.2 ? 0xe0b030 : 0xd9453d;
  }

  /** Rebuilds the status callout whenever pokemon.status changes (see
   * buildStatusBox), and keeps it parked just under the HP bar — which
   * itself tracks the body's feet (see updateHpBar), so the box follows
   * along for any sprite size. Also where the body tint gets re-resolved on
   * a status change, since a frozen Pokémon reads ice-blue. */
  private updateStatusBox(pokemon: PokemonInstance): void {
    if (pokemon.status !== this.shownStatus) {
      this.shownStatus = pokemon.status;
      this.statusBox?.destroy();
      this.statusBox = pokemon.status ? this.buildStatusBox(pokemon.status) : null;
      this.applyBodyTint();
    }
    if (this.statusBox) {
      this.statusBox.y = this.hpBarBg.y + HP_BAR_HEIGHT / 2 + STATUS_BOX_GAP + this.statusBox.height / 2;
    }
  }

  /** The status callout under the Pokémon: a small pill in the status's own
   * color, styled like the move-name label above the sprite (same pixel
   * font, gradient fill, dark border) so the two read as one HUD family. */
  private buildStatusBox(status: StatusCondition): Phaser.GameObjects.Container {
    const color = STATUS_COLORS[status];
    const text = this.scene.add
      .text(0, 0, STATUS_LABELS[status], {
        fontSize: `${STATUS_BOX_FONT_SIZE}px`,
        fontFamily: MOVE_LABEL_FONT_FAMILY,
        color: '#ffffff',
        stroke: '#1a1a1a',
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0.5)
      .setPadding(STATUS_BOX_PAD_X, STATUS_BOX_PAD_Y, STATUS_BOX_PAD_X, STATUS_BOX_PAD_Y);
    const boxWidth = text.width;
    const boxHeight = text.height;
    const bg = this.scene.add.graphics();
    const topColor = shadeColor(color, MOVE_LABEL_SHADE_AMOUNT);
    const bottomColor = shadeColor(color, -MOVE_LABEL_SHADE_AMOUNT);
    bg.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
    bg.fillRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, STATUS_BOX_CORNER_RADIUS);
    bg.lineStyle(MOVE_LABEL_BORDER_WIDTH, MOVE_LABEL_BORDER_COLOR, 1);
    bg.strokeRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, STATUS_BOX_CORNER_RADIUS);

    const box = this.scene.add.container(0, 0, [bg, text]).setSize(boxWidth, boxHeight);
    this.container.add(box);
    // Pops in rather than blinking on, so the moment a status lands is
    // itself a visible beat.
    box.setScale(0);
    this.scene.tweens.add({ targets: box, scale: 1, duration: 180, ease: 'Back.easeOut' });
    return box;
  }

  /** The body has exactly one tint slot (Phaser tints don't layer), so every
   * tint source resolves through here, in priority order: a frozen Pokémon
   * reads ice-blue over everything; otherwise the fallback shiny recolor
   * (SHINY_TINT_COLOR — real shiny art needs no tint, its own colors are
   * already right); otherwise none. Re-run whenever any of those inputs
   * changes: a new body GameObject, a status change, a hit flash ending. */
  private applyBodyTint(): void {
    if (!(this.body instanceof Phaser.GameObjects.Sprite || this.body instanceof Phaser.GameObjects.Image)) return;
    if (this.shownStatus === 'freeze') this.body.setTint(FREEZE_BODY_TINT);
    else if (this.shiny && !this.usingRealShinyArt) this.body.setTint(SHINY_TINT_COLOR);
    else this.body.clearTint();
  }

  /** A frozen Pokémon is a solid block of ice — its looping Idle/Walk (or the
   * hotlink tier's GIF loop / idle bob) shouldn't keep moving under it.
   * One-shots (Hurt, from being hit while frozen) still play through:
   * pausing those would strand pendingOneShot waiting on an
   * animationcomplete that never fires. */
  private applyFrozenPause(frozenStill: boolean): void {
    if (this.body instanceof Phaser.GameObjects.Sprite) {
      if (frozenStill) {
        if (!this.body.anims.isPaused) this.body.anims.pause();
      } else if (this.body.anims.isPaused) {
        this.body.anims.resume();
      }
    }
    if (this.idleTween) {
      if (frozenStill) this.idleTween.pause();
      else if (this.idleTween.isPaused()) this.idleTween.resume();
    }
  }

  /** Starts/stops the ambient VFX loop as pokemon.status changes — one
   * chained timer for whichever status is current, replaying that
   * status's animation with STATUS_VFX_GAP_MS of quiet after each run
   * (see spawnStatusVfx). */
  private updateStatusVfx(pokemon: PokemonInstance): void {
    if (pokemon.status === this.statusVfxFor) return;
    this.statusVfxTimer?.remove();
    this.statusVfxTimer = null;
    this.statusAnimation?.stop();
    this.statusAnimation = null;
    this.statusVfxFor = pokemon.status;
    const status = pokemon.status;
    if (!status) return;
    this.spawnStatusVfx(status); // one immediately, don't wait a full gap to first appear
  }

  private spawnStatusVfx(status: StatusCondition): void {
    if (this.container.scene === undefined) return; // destroyed mid-timer
    if (this.statusVfxFor !== status) return; // status changed while this was pending
    let nextDelayMs = STATUS_VFX_GAP_MS[status];
    if (status === 'sleep') {
      this.spawnSleepZ();
    } else {
      const playedMs = this.playStatusAnimation(status);
      nextDelayMs = playedMs === null ? STATUS_ANIM_RETRY_MS : nextDelayMs + playedMs;
    }
    this.statusVfxTimer = this.scene.time.delayedCall(nextDelayMs, () => this.spawnStatusVfx(status));
  }

  /** Plays the pack's animation for a status condition (Common:Poison,
   * Common:Burn, ...) on this sprite: both of the animation's anchors are
   * this Pokémon, so a target-focused flame licks up its own body and a
   * screen-focused poison cloud centers on it (see geometry.ts). Returns
   * the run's duration in ms, or null if the animation's data hasn't
   * loaded yet (the status box still shows; the loop retries shortly). */
  private playStatusAnimation(status: Exclude<StatusCondition, 'sleep'>): number | null {
    const loaded = getLoadedCommonAnimation(this.scene, STATUS_COMMON_ANIMATIONS[status]);
    if (!loaded) return null;
    const anchor = (): Vec2 => ({ x: this.container.x, y: this.container.y });
    this.statusAnimation = playAnimation({
      scene: this.scene,
      data: loaded.data,
      sheetKey: loaded.sheetKey,
      getAttacker: anchor,
      getTarget: anchor,
      scale: animationScaleFor(this.targetOnScreenSize),
      msPerFrame: frameDurationMs(playableFrameCount(loaded.data.frames), Number.POSITIVE_INFINITY, STATUS_ANIM_PLAYBACK_SPEED),
      onComplete: () => {
        this.statusAnimation = null;
      },
    });
    return this.statusAnimation.durationMs;
  }

  /** Half the body's current on-screen width — the horizontal band the
   * sleep "Z"s drift up from. */
  private bodyHalfWidth(): number {
    return (this.body ? this.body.displayWidth : PLACEHOLDER_RADIUS * 2) * 0.45;
  }

  /** One "Z" drifting up and away from the sleeping Pokémon's head — the
   * classic snooze glyph, drawn as text in the labels' own pixel font rather
   * than a dedicated asset. Pairs with the PMD Sleep animation
   * (desiredPmdAction) that nearly every species has; for the hotlink tier's
   * static art, which has no sleep pose at all, the Z's are the whole tell. */
  private spawnSleepZ(): void {
    const halfWidth = this.bodyHalfWidth();
    const startX = Phaser.Math.Between(halfWidth * 0.2, halfWidth * 0.7);
    const startY = this.topOfBodyY() + 8;
    const z = this.scene.add
      .text(startX, startY, 'Z', {
        fontSize: `${SLEEP_Z_FONT_SIZE}px`,
        fontFamily: MOVE_LABEL_FONT_FAMILY,
        color: '#ffffff',
        stroke: '#1a1a1a',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setScale(0.55)
      .setAlpha(0.95);
    this.container.add(z);
    this.scene.tweens.add({
      targets: z,
      x: startX + 16 + Math.random() * 12,
      y: startY - 44,
      scale: 1.2,
      duration: SLEEP_Z_LIFESPAN_MS,
      ease: 'Sine.easeOut',
      onComplete: () => z.destroy(),
    });
    this.scene.tweens.add({
      targets: z,
      alpha: 0,
      delay: SLEEP_Z_LIFESPAN_MS * 0.55,
      duration: SLEEP_Z_LIFESPAN_MS * 0.45,
    });
  }

  private updateHitFlash(pokemon: PokemonInstance, nowMs: number, allPokemon: Record<string, PokemonInstance>): void {
    if (!pokemon.lastHitAtMs || pokemon.lastHitAtMs === this.lastSeenHitAtMs) return;
    this.lastSeenHitAtMs = pokemon.lastHitAtMs;
    if (!this.body || nowMs - pokemon.lastHitAtMs > 400) return; // stale on first sync, skip

    if (this.body instanceof Phaser.GameObjects.Sprite) {
      this.body.setTintFill(0xffffff);
      this.scene.time.delayedCall(HIT_FLASH_MS, () => {
        // clearTint() would also wipe whatever tint the body is meant to be
        // wearing (Phaser has one tint slot, not layered tints) — the
        // fallback shiny recolor, or a frozen Pokémon's ice-blue — so
        // re-resolve it rather than leaving the body un-tinted after a hit.
        this.applyBodyTint();
      });
      this.triggerPmdOneShot('Hurt', this.computeHitFacing(pokemon, allPokemon));
    }
    this.scene.tweens.add({
      targets: this.container,
      x: this.container.x + Phaser.Math.Between(-4, 4),
      duration: 40,
      yoyo: true,
      repeat: 2,
    });
  }

  /** Container-space Y of the body's current top edge — sprite sizes vary a
   * lot (PMD tier alone ranges ~64-150px tall, scaled per-species), so
   * anything anchored "above the sprite" has to be computed from the actual
   * current body rather than a fixed offset, or it clips into bigger ones. */
  private topOfBodyY(): number {
    if (this.body instanceof Phaser.GameObjects.Sprite || this.body instanceof Phaser.GameObjects.Image) {
      return -this.body.displayHeight * this.body.originY;
    }
    return -PLACEHOLDER_RADIUS; // no body loaded yet
  }

  /** Container-space Y of the body's current bottom edge (feet) — same
   * reasoning as topOfBodyY(): varies with sprite size/origin, so the HP bar
   * has to track it rather than sit at a fixed offset. */
  private bottomOfBodyY(): number {
    if (this.body instanceof Phaser.GameObjects.Sprite || this.body instanceof Phaser.GameObjects.Image) {
      return this.body.displayHeight * (1 - this.body.originY);
    }
    return PLACEHOLDER_RADIUS; // no body loaded yet
  }

  /** Shows the move-name callout above this sprite. Returns a function that
   * hides it again — the caller (ArenaScene) invokes it once the attack's
   * on-screen animation finishes, so the label never lingers once there's no
   * attack actually in progress. Safe to call even if a later attack has
   * already replaced or cleared this label (e.g. destroy() ran first, or
   * this sprite is mid-way through a newer showMoveLabel() call) — it only
   * clears the exact label instance this call created. */
  showMoveLabel(move: MoveDefinition): () => void {
    this.moveLabel?.destroy();
    const color = getMoveTypeColor(move.type);
    const text = this.scene.add
      .text(0, 0, move.name.toUpperCase(), {
        fontSize: `${MOVE_LABEL_FONT_SIZE}px`,
        fontFamily: MOVE_LABEL_FONT_FAMILY,
        color: '#ffffff',
        stroke: '#1a1a1a',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setPadding(MOVE_LABEL_PAD_X, MOVE_LABEL_PAD_Y, MOVE_LABEL_PAD_X, MOVE_LABEL_PAD_Y);

    // A flat-fill rectangle (the old look) reads as a cheap tooltip; a
    // vertically-graded, bordered, rounded pill matches the glossy "button"
    // callout style of the reference battle UI this is modeled on.
    const boxWidth = text.width;
    const boxHeight = text.height;
    const bg = this.scene.add.graphics();
    const topColor = shadeColor(color, MOVE_LABEL_SHADE_AMOUNT);
    const bottomColor = shadeColor(color, -MOVE_LABEL_SHADE_AMOUNT);
    bg.fillGradientStyle(topColor, topColor, bottomColor, bottomColor, 1);
    bg.fillRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, MOVE_LABEL_CORNER_RADIUS);
    bg.lineStyle(MOVE_LABEL_BORDER_WIDTH, MOVE_LABEL_BORDER_COLOR, 1);
    bg.strokeRoundedRect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, MOVE_LABEL_CORNER_RADIUS);

    // Anchor by the box's bottom edge (not its center) so MOVE_LABEL_GAP stays
    // an accurate clearance above the sprite regardless of how tall the box is.
    // Clamped so the label can never float up into the roster/HP HUD strip
    // reserved by ARENA_TOP_PADDING (see that constant's own comment) — a
    // Pokémon fighting near the top of the arena already has its own body
    // kept clear of the HUD by that same padding, but this label floats
    // further above the body still, so without this it would silently render
    // underneath the HUD's DOM overlay (see MatchScreen.tsx) instead: an
    // attack playing with no visible move-name callout above it.
    const desiredContainerY = this.topOfBodyY() - MOVE_LABEL_GAP - boxHeight / 2;
    const minContainerY = ARENA_TOP_PADDING - this.container.y;
    const containerY = Math.max(desiredContainerY, minContainerY);
    const label = this.scene.add.container(0, containerY, [bg, text]);
    this.moveLabel = label;
    this.container.add(label);

    return () => {
      if (this.moveLabel === label) {
        this.moveLabel.destroy();
        this.moveLabel = null;
      }
    };
  }

  playFaintAndDestroy(onComplete: () => void): void {
    if (this.hasFainted) return;
    this.hasFainted = true;
    this.idleTween?.stop();
    this.triggerPmdOneShot('Faint');
    // 500 = today's baseline fade duration, kept as a floor; stretched only
    // when a real Faint animation is playing, so it isn't cut off early.
    const faintMs = this.pmdActions.Faint?.durationsMs.reduce((a, b) => a + b, 0) ?? 0;
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scale: 0.6,
      duration: Math.max(500, faintMs),
      ease: 'Cubic.easeIn',
      onComplete: () => {
        this.destroy();
        onComplete();
      },
    });
  }

  destroy(): void {
    this.moveLabel?.destroy();
    this.idleTween?.stop();
    this.statusVfxTimer?.remove();
    this.statusVfxTimer = null;
    this.statusAnimation?.stop();
    this.statusAnimation = null;
    this.pendingDodge?.remove();
    this.pendingDodge = null;
    this.offsetTween?.stop();
    this.offsetTween = null;
    this.shinyAura?.destroy();
    this.shinyAura = null;
    this.container.destroy();
  }
}
