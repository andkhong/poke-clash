import Phaser from 'phaser';
import type { PokemonInstance, SimState, Vec2 } from '../sim/types';
import { createMatch } from '../sim/matchSetup';
import { createRng } from '../sim/rng';
import { velocityToFacing } from '../sim/movement';
import { POST_ATTACK_HOLD_MS } from '../sim/constants';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../sim/struggle';
import { ANIM_NATIVE_FPS, playableFrameCount } from '../data/moveAnimationFormat';
import { buildSpeciesMapForLevel, getMoveDefinition, moveLookup } from '../data/loader';
import type { PmdSpriteIndex, SpriteIndex } from '../data/types';
import spriteIndexData from '../data/generated/spriteIndex.json';
import { PokemonSprite } from '../render/sprites/PokemonSprite';
import { preloadPokeballAsset } from '../render/sprites/pokeballAsset';
import { pmdSpriteIndexUrl } from '../render/sprites/pmdSheetUrl';
import { createTiledArenaBackground, preloadArenaTileset } from '../render/tileset/arenaBackground';
import { frameDurationMs, playAnimation, type AnimationHandle } from '../render/vfx/anim/AnimPlayer';
import { animationScaleFor } from '../render/vfx/anim/geometry';
import { playFallbackFlash } from '../render/vfx/anim/fallbackFlash';
import { getLoadedMoveAnimation, getMoveAnimationEntry, queueAnimationLoads } from '../render/vfx/anim/moveAnimLoader';
import { familyAnchorsAtBodyCenter, playFamilyVfx, preloadFamilyVfxAssets } from '../render/vfx/moves/playFamilyVfx';
import { getMoveVfxAdjustment } from '../render/vfx/moveVfxAdjustments';
import { resolveMoveVfxSource } from '../render/vfx/moveVfxSource';
import { playMoveSound } from '../render/sound/moveSound';
import { installMasterLimiter } from '../render/sound/masterBus';

// The review page's stage: two real arena Pokémon (PokemonSprite, with
// their Pokéball entrance, idle/attack poses and HP bars) standing on the
// arena's ground, and a playMove() that fires a move from one at the other
// exactly the way ArenaScene.handleMoveUsed does — same pack-animation-vs-
// family-VFX decision, same pose choice, same scale/timing, same label and
// sound — but on demand, without a simulation running. The decision logic
// is mirrored here rather than shared because the arena's version is
// woven into its attack queue; keep the two in step.

export const REVIEW_STAGE_WIDTH = 960;
export const REVIEW_STAGE_HEIGHT = 540;
/** The arena background fences off its top ARENA_TOP_PADDING px for the
 * HUD; the camera scrolls past most of that so the stage isn't half fence. */
const WORLD_TOP = 150;
const WORLD_HEIGHT = REVIEW_STAGE_HEIGHT + WORLD_TOP;
const STAGE_CENTER: Vec2 = { x: REVIEW_STAGE_WIDTH / 2, y: WORLD_TOP + REVIEW_STAGE_HEIGHT / 2 + 30 };
const REVIEW_LEVEL = 50;
const PMD_SPRITE_INDEX_KEY = 'pmd-sprite-index';
/** How long to wait for a pack animation's JSON + sheet before giving up
 * and showing the fallback flash. */
const PACK_LOAD_TIMEOUT_MS = 15_000;
/** After the arena's own hold window, how much longer slower playback keeps
 * the label/sound/pose up past the animation's end. */
const SLOW_PLAYBACK_TAIL_MS = 250;
/** A hit takes this much of the target's HP so the bar visibly drops; it
 * refills once it gets low so the target never faints. */
const HIT_HP_FRACTION = 0.15;
const REFILL_BELOW_FRACTION = 0.25;
// Same miss timings as ArenaScene (a family VFX takes ~200ms to arrive, a
// lunge lands at its 120ms apex; pack animations reach the target in
// roughly their first third, capped).
const FAMILY_MISS_DELAY_MS = 200;
const LUNGE_MISS_DELAY_MS = 100;
const MISS_DELAY_FRACTION = 0.35;
const MAX_MISS_DELAY_MS = 300;

/** 'arena' plays exactly what a match shows: twice the pack's native rate,
 * compressed to fit the attacker's hold window (see AnimPlayer.ts). The
 * others are for studying an effect frame by frame. */
export type PlaybackSpeed = 'arena' | 'native' | 'slow';

export interface ReviewPlaybackOptions {
  speed: PlaybackSpeed;
  sound: boolean;
  /** Play the miss version: the effect lands where the target stood and the
   * target sidesteps it (see PokemonSprite.playDodge). */
  miss: boolean;
  /** False replays a move the way the arena drew it before the VFX review's
   * changes — anchors at the sprites' feet, no per-move tuning
   * (moveVfxAdjustments.ts) — so a proposed change can be compared with
   * what it replaced. True is what a match shows today. */
  adjustments: boolean;
  /** Force where the effect comes from, regardless of the arena's decision:
   * 'pack' plays the pack animation even where the arena wouldn't use it
   * (a screen-wide one), 'arena' the arena's family effect — the "with /
   * without the assets" comparison. Omit for the arena's own choice. */
  source?: 'pack' | 'arena';
}

/** Where the two fighters stand: `distance` px apart, the target at
 * `angleDeg` clockwise from "to the right of" the attacker. */
export interface ReviewLayout {
  distance: number;
  angleDeg: number;
}

export interface ReviewSceneData {
  attackerSpeciesId: number;
  targetSpeciesId: number;
  layout: ReviewLayout;
}

export type ReviewStageStatus =
  | { kind: 'booting' }
  | { kind: 'idle' }
  | { kind: 'loading'; moveId: number }
  | { kind: 'playing'; moveId: number; durationMs: number; variant: 'before' | 'after' }
  | { kind: 'error'; moveId: number; message: string };

interface ActivePlayback {
  stop(): void;
}

function msPerFrameFor(speed: PlaybackSpeed, frames: number, arenaSpeed?: number): number {
  switch (speed) {
    case 'arena':
      return frameDurationMs(frames, POST_ATTACK_HOLD_MS, arenaSpeed);
    case 'native':
      return 1000 / ANIM_NATIVE_FPS;
    case 'slow':
      return 2000 / ANIM_NATIVE_FPS;
  }
}

export class ReviewScene extends Phaser.Scene {
  private attackerSpeciesId = 0;
  private targetSpeciesId = 0;
  private layout: ReviewLayout = { distance: 220, angleDeg: 0 };

  private state: SimState | null = null;
  private attackerId = '';
  private targetId = '';
  private readonly sprites = new Map<string, PokemonSprite>();
  private pmdSpriteIndex: PmdSpriteIndex | null = null;
  /** The stage's own clock (ms), the `nowMs` the sprites read hit/hold
   * timings against — the sim's elapsedMs in a real match. */
  private clockMs = 0;

  private status: ReviewStageStatus = { kind: 'booting' };
  private readonly listeners = new Set<(status: ReviewStageStatus) => void>();
  private active: ActivePlayback | null = null;
  /** Bumped by every playMove() so an await that outlives a newer call
   * (or a species swap) knows to bail instead of firing a stale move. */
  private playToken = 0;

  constructor() {
    super('Review');
  }

  init(data: ReviewSceneData): void {
    this.attackerSpeciesId = data.attackerSpeciesId;
    this.targetSpeciesId = data.targetSpeciesId;
    this.layout = data.layout;
  }

  preload(): void {
    this.load.json(PMD_SPRITE_INDEX_KEY, pmdSpriteIndexUrl());
    preloadArenaTileset(this);
    preloadPokeballAsset(this);
    preloadFamilyVfxAssets(this);
  }

  create(): void {
    createTiledArenaBackground(this, REVIEW_STAGE_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#1a1a1a');
    this.cameras.main.setScroll(0, WORLD_TOP);
    installMasterLimiter(this);
    this.pmdSpriteIndex = (this.cache.json.get(PMD_SPRITE_INDEX_KEY) as PmdSpriteIndex | undefined) ?? null;
    if (!this.pmdSpriteIndex) console.warn('[ReviewScene] PMD sprite index failed to load; falling back to static art');
    this.spawn();
    this.setStatus({ kind: 'idle' });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stopActive();
      this.listeners.clear();
    });
  }

  update(_time: number, delta: number): void {
    const state = this.state;
    if (!state) return;
    this.clockMs += delta;
    for (const id of state.livingOrder) {
      const pokemon = state.pokemon[id];
      // The engine counts the hold window down each tick; here that's the
      // only sim rule that matters (it's what keeps the attack facing/pose).
      pokemon.postAttackHoldMs = Math.max(0, pokemon.postAttackHoldMs - delta);
      this.sprites.get(id)?.update(pokemon, pokemon.position.x, pokemon.position.y, this.clockMs, state.pokemon);
    }
  }

  /** Reports status changes; the listener is called immediately with the
   * current status. Returns the unsubscribe function. */
  subscribe(listener: (status: ReviewStageStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSpecies(attackerSpeciesId: number, targetSpeciesId: number): void {
    if (attackerSpeciesId === this.attackerSpeciesId && targetSpeciesId === this.targetSpeciesId) return;
    this.attackerSpeciesId = attackerSpeciesId;
    this.targetSpeciesId = targetSpeciesId;
    if (!this.state) return; // create() will spawn with these
    this.playToken += 1;
    this.stopActive();
    this.spawn();
    this.setStatus({ kind: 'idle' });
  }

  setLayout(layout: ReviewLayout): void {
    this.layout = layout;
    if (this.state) this.applyLayout();
  }

  /** Starts downloading pack animations the reviewer is likely to open
   * next, so they play without a loading pause. */
  prefetch(moveIds: readonly number[]): void {
    if (!this.state) return;
    if (queueAnimationLoads(this, moveIds) > 0 && !this.load.isLoading()) this.load.start();
  }

  /** Fires `moveId` from the attacker at the target. Resolves once the
   * effect has started (after any download); a newer call cancels an
   * in-flight one. */
  async playMove(moveId: number, options: ReviewPlaybackOptions): Promise<void> {
    const state = this.state;
    if (!state) return;
    const move = moveId === STRUGGLE_MOVE_ID ? STRUGGLE_MOVE : getMoveDefinition(moveId);
    if (!move) return;
    const token = ++this.playToken;
    this.stopActive();

    // Same decision as ArenaScene.handleMoveUsed: a pack animation unless
    // the pack has none or it's screen-wide, in which case the arena's own
    // family VFX.
    const entry = getMoveAnimationEntry(move.id);
    const adjustment = options.adjustments ? getMoveVfxAdjustment(move.id) : undefined;
    const source = resolveMoveVfxSource(move, entry, adjustment, options.source);
    const family = source.kind === 'family' ? source.family : null;
    if (!family && entry && !getLoadedMoveAnimation(this, move.id)) {
      this.setStatus({ kind: 'loading', moveId });
      await this.loadMoveAnimation(move.id);
      if (token !== this.playToken || !this.sys.isActive()) return;
    }

    const attacker = state.pokemon[this.attackerId];
    const target = state.pokemon[this.targetId];
    const attackerSprite = this.sprites.get(this.attackerId);
    const targetSprite = this.sprites.get(this.targetId);
    if (!attacker || !target || !attackerSprite || !targetSprite) return;

    const selfTargeting = move.targeting === 'self';
    const hit = !selfTargeting && !options.miss;
    const attackerPosition = attackerSprite.getRenderPosition();
    const targetPosition = targetSprite.getRenderPosition();

    // The sim-side bookkeeping the sprites read: the attacker holds its
    // attack facing for the hold window; a hit target flashes, plays Hurt,
    // turns toward the attacker and loses some HP (see PokemonSprite.update).
    attacker.postAttackHoldMs = POST_ATTACK_HOLD_MS;
    attacker.lastAttackAtMs = this.clockMs;
    if (hit) {
      target.postAttackHoldMs = POST_ATTACK_HOLD_MS;
      target.lastHitAtMs = this.clockMs;
      target.lastDamagedByInstanceId = attacker.instanceId;
      if (move.power) applyReviewDamage(target);
    }

    const ranged = family ? family !== 'lunge' : !(entry?.melee || move.category === 'physical');
    const unlockPosition = attackerSprite.lockPosition();
    attackerSprite.playPmdAttack(attackerPosition, selfTargeting ? undefined : targetPosition, ranged);
    const hideMoveLabel = attackerSprite.showMoveLabel(move);
    const soundHandle = options.sound ? playMoveSound(this, move) : undefined;

    let animation: AnimationHandle | null = null;
    let durationMs = POST_ATTACK_HOLD_MS;
    let failure: string | null = null;
    // With adjustments off everything anchors at the feet, as it did before
    // the review; on, every pack animation and the arena's beams/jets/bolts
    // run between the bodies' centers (see PokemonSprite.getAnimAnchor and
    // familyAnchorsAtBodyCenter) while dashes and ground effects stay put.
    const anchorOf = (sprite: PokemonSprite, lifted: boolean): Vec2 => (lifted ? sprite.getAnimAnchor() : sprite.getRenderPosition());
    if (family) {
      if (!selfTargeting) {
        const bodyCenter = adjustment?.familyAnchor ? adjustment.familyAnchor === 'center' : familyAnchorsAtBodyCenter(family);
        const lifted = options.adjustments && bodyCenter;
        // A lunge steers by the feet but (after the review) lands its hit on the body.
        const contact = anchorOf(targetSprite, options.adjustments);
        playFamilyVfx(this, family, anchorOf(attackerSprite, lifted), anchorOf(targetSprite, lifted), target.collisionRadius, move.type, attackerSprite, contact);
        if (options.miss) targetSprite.playDodge(attackerPosition, family === 'lunge' ? LUNGE_MISS_DELAY_MS : FAMILY_MISS_DELAY_MS);
      }
    } else {
      const loaded = getLoadedMoveAnimation(this, move.id);
      const lifted = options.adjustments;
      const attackerAnchor = anchorOf(attackerSprite, lifted);
      const targetAnchor = anchorOf(targetSprite, lifted);
      const impact = selfTargeting ? attackerAnchor : targetAnchor;
      if (!loaded) {
        playFallbackFlash(this, impact.x, impact.y, move.type);
        failure = 'The pack animation failed to download; showing the arena’s fallback flash instead.';
      } else {
        // The pack's battler-only animations draw nothing themselves.
        if (!loaded.sheetKey) playFallbackFlash(this, impact.x, impact.y, move.type);
        const getAttacker = (): Vec2 => (attackerSprite.isDestroyed() ? attackerAnchor : anchorOf(attackerSprite, lifted));
        const getTarget = (): Vec2 => {
          if (selfTargeting) return getAttacker();
          // A missed target isn't followed: the attack goes where it was.
          if (options.miss || targetSprite.isDestroyed()) return targetAnchor;
          return anchorOf(targetSprite, lifted);
        };
        const getAttackerDepth = (): number => (attackerSprite.isDestroyed() ? attackerPosition.y : attackerSprite.getRenderPosition().y);
        const getTargetDepth = (): number => {
          if (selfTargeting) return getAttackerDepth();
          if (options.miss || targetSprite.isDestroyed()) return targetPosition.y;
          return targetSprite.getRenderPosition().y;
        };
        animation = playAnimation({
          scene: this,
          data: loaded.data,
          sheetKey: loaded.sheetKey,
          getAttacker,
          getTarget,
          getAttackerDepth,
          getTargetDepth,
          scale: animationScaleFor(attackerSprite.getOnScreenSize()) * (adjustment?.scale ?? 1),
          cellOffset: adjustment?.offset,
          dropCells: adjustment?.dropCells,
          dropPatterns: adjustment?.dropPatterns,
          screenAnchor: adjustment?.screenAnchor,
          upright: adjustment?.upright,
          patternCycle: adjustment?.patternCycle,
          msPerFrame: msPerFrameFor(options.speed, playableFrameCount(loaded.data.frames), adjustment?.playbackSpeed),
          attacker: attackerSprite,
          target: hit ? targetSprite : undefined,
        });
        durationMs = animation.durationMs;
        if (options.miss && !selfTargeting) {
          targetSprite.playDodge(attackerPosition, Math.min(MAX_MISS_DELAY_MS, durationMs * MISS_DELAY_FRACTION));
        }
      }
    }

    // A match cuts the label, sound and pose at the hold window whatever
    // the animation is doing; slower playback gets the whole animation.
    const windowMs = options.speed === 'arena' ? POST_ATTACK_HOLD_MS : Math.max(POST_ATTACK_HOLD_MS, durationMs + SLOW_PLAYBACK_TAIL_MS);
    let timer: Phaser.Time.TimerEvent | null = null;
    const playback: ActivePlayback = {
      stop: () => {
        if (this.active !== playback) return;
        this.active = null;
        timer?.remove();
        animation?.stop();
        soundHandle?.stop();
        hideMoveLabel();
        unlockPosition();
      },
    };
    this.active = playback;
    timer = this.time.delayedCall(windowMs, () => {
      playback.stop();
      this.setStatus(failure ? { kind: 'error', moveId, message: failure } : { kind: 'idle' });
    });
    this.setStatus({ kind: 'playing', moveId, durationMs: windowMs, variant: options.adjustments ? 'after' : 'before' });
  }

  private setStatus(status: ReviewStageStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  private stopActive(): void {
    this.active?.stop();
    this.active = null;
  }

  private loadMoveAnimation(moveId: number): Promise<void> {
    return new Promise((resolve) => {
      // Phaser's loader dedups by key, so re-queuing a file that's already
      // in flight (a prefetch) is harmless; either way, wait for the
      // whole queue to finish before reading the cache.
      const queued = queueAnimationLoads(this, [moveId]);
      if (queued === 0 && !this.load.isLoading()) {
        resolve();
        return;
      }
      let timer: Phaser.Time.TimerEvent | null = null;
      const done = (): void => {
        this.load.off(Phaser.Loader.Events.COMPLETE, done);
        timer?.remove();
        resolve();
      };
      timer = this.time.delayedCall(PACK_LOAD_TIMEOUT_MS, done);
      this.load.on(Phaser.Loader.Events.COMPLETE, done);
      if (!this.load.isLoading()) this.load.start();
    });
  }

  /** (Re)builds the two fighters: a real two-Pokémon match state (so the
   * sprites get genuine stats, sizes and HP) with the fighters placed per
   * the layout, then a PokemonSprite each. */
  private spawn(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();

    const speciesIds = [this.attackerSpeciesId, this.targetSpeciesId];
    const species = buildSpeciesMapForLevel(speciesIds, REVIEW_LEVEL);
    const state = createMatch(
      {
        level: REVIEW_LEVEL,
        speciesIds,
        arena: { width: REVIEW_STAGE_WIDTH, height: WORLD_HEIGHT },
        shiny: false,
        disableWander: true,
      },
      species,
      moveLookup,
      createRng(1)
    );
    this.state = state;
    [this.attackerId, this.targetId] = state.livingOrder;
    // Both stay in the 'attack' AI state (the pose is Idle, not Walk, and
    // desiredFacing keeps each turned toward the other during a hold),
    // pointed at each other, and never wander.
    const attacker = state.pokemon[this.attackerId];
    const target = state.pokemon[this.targetId];
    attacker.aiState = 'attack';
    attacker.targetInstanceId = target.instanceId;
    target.aiState = 'attack';
    target.targetInstanceId = attacker.instanceId;
    // Positions must be final before the sprites are built: a sprite's
    // render position starts from where its Pokémon stands.
    this.applyLayout();

    const spriteIndex = spriteIndexData as SpriteIndex;
    for (const id of state.livingOrder) {
      this.sprites.set(id, new PokemonSprite(this, state.pokemon[id], spriteIndex, this.pmdSpriteIndex, 0, state.shiny));
    }
  }

  private applyLayout(): void {
    const state = this.state;
    if (!state) return;
    const attacker = state.pokemon[this.attackerId];
    const target = state.pokemon[this.targetId];
    const radians = (this.layout.angleDeg * Math.PI) / 180;
    const dx = Math.cos(radians) * (this.layout.distance / 2);
    const dy = Math.sin(radians) * (this.layout.distance / 2);
    attacker.position = { x: STAGE_CENTER.x - dx, y: STAGE_CENTER.y - dy };
    target.position = { x: STAGE_CENTER.x + dx, y: STAGE_CENTER.y + dy };
    // Outside a hold the sprites show the sim's movement facing; face each other.
    attacker.facing = velocityToFacing({ x: dx, y: dy }, attacker.facing);
    target.facing = velocityToFacing({ x: -dx, y: -dy }, target.facing);
  }
}

function applyReviewDamage(target: PokemonInstance): void {
  if (target.currentHp <= target.maxHp * REFILL_BELOW_FRACTION) target.currentHp = target.maxHp;
  target.currentHp = Math.max(1, target.currentHp - Math.round(target.maxHp * HIT_HP_FRACTION));
}
