import Phaser from 'phaser';
import type { FacingDirection, PokemonInstance, StatusCondition, Vec2 } from '../../sim/types';
import type { PmdAnimEntry, PmdSpriteIndex, SpriteIndex } from '../../data/types';
import { downgradeTier, resolveSpriteUrls, type SpriteUrls } from './spriteResolver';
import { loadGifAsAnimatedTexture } from './gifTexture';
import { acquireSpriteSlot, releaseSpriteSlot } from './fetchQueue';
import { getMoveTypeColor } from '../vfx/typeColor';
import { POKEBALL_TEXTURE_KEY } from './pokeballAsset';
import { playCry } from './cryAudio';
import { playSparkleReveal } from '../vfx/sparkle';
import type { MoveDefinition } from '../../sim/types';
import { BALL_DROP_DURATION_MS, BALL_DROP_STAGGER_MS } from '../../sim/constants';

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
const STATUS_TEXT_Y = -44;
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
const MOVE_LABEL_MS = 1300;
const BALL_DROP_HEIGHT = 260;
const BALL_STAGGER_JITTER_MS = 40;
/** How much of the gap to the true sim position to close each render frame —
 * gives smooth 60fps motion from a 20Hz sim without needing fixed-timestep
 * interpolation bookkeeping in the engine. */
const POSITION_SMOOTHING = 0.25;
const STATUS_LABELS: Record<StatusCondition, string> = {
  sleep: 'ZZZ',
  paralysis: 'PAR',
  burn: 'BRN',
  poison: 'PSN',
  freeze: 'FRZ',
};
const STATUS_COLORS: Record<StatusCondition, string> = {
  sleep: '#7b68c4',
  paralysis: '#e0c030',
  burn: '#e0703c',
  poison: '#9048c0',
  freeze: '#60c8e0',
};

/**
 * PMDCollab/SpriteCollab sheets lay out one row per compass direction, in a
 * fixed order verified against PMD2's own game data (pmd2scriptdata.xml:
 * "Sprites have 8 directions... DOWN is 0"). Real art exists per direction —
 * no flip/tilt approximation needed for this tier.
 */
const FACING_TO_ROW: Record<FacingDirection, number> = {
  S: 0, SE: 1, E: 2, NE: 3, N: 4, NW: 5, W: 6, SW: 7,
};

/**
 * Unlike the hotlink tier (which normalizes every sprite to
 * TARGET_SPRITE_SIZE regardless of source resolution, since Showdown/PokeAPI
 * art isn't drawn at a consistent relative scale), PMD frame sizes ARE
 * authored at consistent in-game scale across the whole roster — a Wailord's
 * Idle frame really is bigger than a Voltorb's on purpose. Normalizing each
 * species to the same box (as the hotlink tier does) would erase that and
 * make every Pokémon the same apparent size, so every PMD sprite instead
 * shares ONE multiplier applied to its native frame size, preserving
 * relative proportions. Idle frame longest-side across the full indexed
 * roster ranges 24-128px (median 48px); the multiplier and clamp below were
 * picked so that range lands roughly in the same on-screen ballpark as
 * TARGET_SPRITE_SIZE without letting the smallest/largest outliers
 * disappear or dominate the arena. (All three values are the same 1.5x
 * upscale applied to TARGET_SPRITE_SIZE, so the two tiers stay proportional
 * to each other.)
 */
const PMD_NATIVE_SCALE = 3.375;
const PMD_MIN_SPRITE_SIZE = 84;
const PMD_MAX_SPRITE_SIZE = 270;

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
  private readonly container: Phaser.GameObjects.Container;
  private readonly placeholder: Phaser.GameObjects.Arc;
  private body: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image | null = null;
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;
  private readonly statusText: Phaser.GameObjects.Text;
  private moveLabel: Phaser.GameObjects.Container | null = null;
  private moveLabelHideAt = 0;

  private frontIsAnimated = false;
  private backIsAnimated = false;
  private lastSeenHitAtMs = 0;
  private isShowingBack = false;
  private hasFainted = false;
  private idleTween: Phaser.Tweens.Tween | null = null;

  private isPmdTier = false;
  /** Only the actions that actually finished loading (a subset of the index entry's). */
  private pmdActions: Record<string, PmdAnimEntry> = {};
  private pmdScale = 1;
  private pendingOneShot: string | null = null;
  private lastFacing: FacingDirection = 'S';

  private hasRevealed = false;
  private pokeball: Phaser.GameObjects.Image | null = null;
  private renderPos: Vec2;

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
    spawnIndex: number
  ) {
    this.scene = scene;
    this.instanceId = pokemon.instanceId;
    this.speciesId = pokemon.speciesId;
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
    // exists — placed at 0 here since sprite sizes vary too much (56-180px
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

    this.statusText = scene.add
      .text(0, STATUS_TEXT_Y, '', { fontSize: '9px', fontFamily: 'monospace', fontStyle: 'bold' })
      .setOrigin(0.5, 0.5)
      .setPadding(2, 1, 2, 1);
    this.statusText.setVisible(false);
    this.container.add(this.statusText);

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
    playSparkleReveal(this.scene, targetPos.x, targetPos.y);

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
    return `poke-${this.speciesId}-pmd-${action}`;
  }

  private pmdAnimKey(action: string, row: number): string {
    return `poke-${this.speciesId}-pmd-${action}-r${row}`;
  }

  private async tryLoadPmdSprites(entry: PmdSpriteIndex[string]): Promise<boolean> {
    if (!entry.actions.Idle || !entry.actions.Walk) return false; // defensive re-check of the pipeline's own gate

    const loaded: Record<string, PmdAnimEntry> = {};
    await Promise.all(
      Object.entries(entry.actions).map(async ([action, meta]) => {
        const key = this.pmdTextureKey(action);
        const ok = await this.loadSpriteSheet(key, `/pmd-sprites/${entry.dir}/${action}-Anim.png`, {
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
    const nativeSize = Math.max(loaded.Idle.frameWidth, loaded.Idle.frameHeight, 1);
    const targetSize = Math.min(PMD_MAX_SPRITE_SIZE, Math.max(PMD_MIN_SPRITE_SIZE, nativeSize * PMD_NATIVE_SCALE));
    this.pmdScale = targetSize / nativeSize;
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
    const isOneShot = action === 'Attack' || action === 'Hurt' || action === 'Faint';
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
    // No synthetic idle-bob tween here — PMD's own Idle animation already has
    // baked motion; adding the old hotlink-tier tween on top would double it.
    sprite.play(this.pmdAnimKey('Idle', FACING_TO_ROW.S));
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
    const scale = TARGET_SPRITE_SIZE / Math.max(sprite.width, sprite.height, 1);
    sprite.setScale(scale);
    sprite.setVisible(this.hasRevealed); // stays hidden under the Pokéball until it pops open
    this.container.addAt(sprite, 0);
    this.body = sprite;

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
  }

  update(pokemon: PokemonInstance, screenX: number, screenY: number, nowMs: number): void {
    if (!this.hasRevealed) return; // entrance tween owns position/visibility until it lands

    this.renderPos.x += (screenX - this.renderPos.x) * POSITION_SMOOTHING;
    this.renderPos.y += (screenY - this.renderPos.y) * POSITION_SMOOTHING;
    this.container.setPosition(this.renderPos.x, this.renderPos.y);
    this.container.setDepth(this.renderPos.y);

    this.updateFacing(pokemon);
    this.updateHpBar(pokemon);
    this.updateStatus(pokemon);
    this.updateHitFlash(pokemon, nowMs);
    this.updateMoveLabel(nowMs);
  }

  private updateFacing(pokemon: PokemonInstance): void {
    if (!this.body) return;
    this.lastFacing = pokemon.facing;

    if (this.isPmdTier) {
      this.updatePmdAnimationState(pokemon);
      return;
    }

    const config = FACING_CONFIG[pokemon.facing];

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
  }

  private desiredPmdAction(pokemon: PokemonInstance): string {
    if (pokemon.status === 'sleep' && this.pmdActions.Sleep) return 'Sleep';
    const wantsWalk = pokemon.aiState === 'wander' || pokemon.aiState === 'chase';
    return wantsWalk && this.pmdActions.Walk ? 'Walk' : 'Idle';
  }

  private updatePmdAnimationState(pokemon: PokemonInstance): void {
    if (!(this.body instanceof Phaser.GameObjects.Sprite)) return;
    const action = this.pendingOneShot ?? this.desiredPmdAction(pokemon);
    const meta = this.pmdActions[action];
    if (!meta) return;
    const row = meta.directions === 8 ? FACING_TO_ROW[pokemon.facing] : 0;
    // ignoreIfPlaying=true: no-ops if this exact key (same action AND
    // direction) is already current, so only a genuine action/facing change
    // restarts the animation from frame 0.
    this.body.play(this.pmdAnimKey(action, row), true);
  }

  /** Fires a one-shot PMD action (Attack/Hurt/Faint), then lets the looping
   * Idle/Walk state resume once it completes. No-op for non-PMD-tier sprites
   * or actions this species doesn't have. */
  private triggerPmdOneShot(action: string): void {
    if (!this.isPmdTier || !this.pmdActions[action] || !(this.body instanceof Phaser.GameObjects.Sprite)) return;
    this.pendingOneShot = action;
    const meta = this.pmdActions[action];
    const row = meta.directions === 8 ? FACING_TO_ROW[this.lastFacing] : 0;
    const key = this.pmdAnimKey(action, row);
    this.body.play(key, true);
    this.body.once(`animationcomplete-${key}`, () => {
      if (this.pendingOneShot === action) this.pendingOneShot = null;
    });
  }

  /** Called by ArenaScene on a 'moveUsed' event for the attacker. */
  playPmdAttack(): void {
    this.triggerPmdOneShot('Attack');
  }

  private updateHpBar(pokemon: PokemonInstance): void {
    const y = this.bottomOfBodyY() + HP_BAR_GAP;
    this.hpBarBg.y = y;
    this.hpBarFill.y = y;

    const ratio = pokemon.maxHp > 0 ? Math.max(0, pokemon.currentHp / pokemon.maxHp) : 0;
    this.hpBarFill.width = HP_BAR_WIDTH * ratio;
    this.hpBarFill.fillColor = ratio > 0.5 ? 0x4caf50 : ratio > 0.2 ? 0xe0b030 : 0xd9453d;
  }

  private updateStatus(pokemon: PokemonInstance): void {
    if (!pokemon.status) {
      this.statusText.setVisible(false);
      return;
    }
    this.statusText.setText(STATUS_LABELS[pokemon.status]);
    this.statusText.setBackgroundColor(STATUS_COLORS[pokemon.status]);
    this.statusText.setColor('#ffffff');
    this.statusText.setVisible(true);
  }

  private updateHitFlash(pokemon: PokemonInstance, nowMs: number): void {
    if (!pokemon.lastHitAtMs || pokemon.lastHitAtMs === this.lastSeenHitAtMs) return;
    this.lastSeenHitAtMs = pokemon.lastHitAtMs;
    if (!this.body || nowMs - pokemon.lastHitAtMs > 400) return; // stale on first sync, skip

    if (this.body instanceof Phaser.GameObjects.Sprite) {
      this.body.setTintFill(0xffffff);
      this.scene.time.delayedCall(HIT_FLASH_MS, () => {
        if (this.body) this.body.clearTint();
      });
      this.triggerPmdOneShot('Hurt');
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
   * lot (PMD tier alone ranges ~56-180px tall, scaled per-species), so
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

  showMoveLabel(move: MoveDefinition): void {
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
    const containerY = this.topOfBodyY() - MOVE_LABEL_GAP - boxHeight / 2;
    this.moveLabel = this.scene.add.container(0, containerY, [bg, text]);
    this.container.add(this.moveLabel);
    this.moveLabelHideAt = this.scene.time.now + MOVE_LABEL_MS;
  }

  private updateMoveLabel(nowMs: number): void {
    if (this.moveLabel && nowMs >= this.moveLabelHideAt) {
      this.moveLabel.destroy();
      this.moveLabel = null;
    }
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
    this.container.destroy();
  }
}
