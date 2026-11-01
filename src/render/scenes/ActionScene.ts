import Phaser from 'phaser';
import type { ActionEngine, ActionEvent } from '../../sim/action/ActionEngine';
import type { PlayerController } from '../../sim/action/playerController';
import { AOE_RADIUS, PROJECTILE } from '../../sim/action/rules';
import type { MoveDefinition, SimState, Vec2 } from '../../sim/types';
import { PokemonSprite } from '../sprites/PokemonSprite';
import { createStadiumBackground, type Stadium } from '../tileset/stadiumBackground';
import { preloadPokeballAsset } from '../sprites/pokeballAsset';
import { playImpactBurst } from '../vfx/moves/impactBurst';
import { familyAnchorsAtBodyCenter, playFamilyVfx, preloadFamilyVfxAssets } from '../vfx/moves/playFamilyVfx';
import { frameDurationMs, playAnimation } from '../vfx/anim/AnimPlayer';
import { animationScaleFor } from '../vfx/anim/geometry';
import { getLoadedMoveAnimation, getMoveAnimationEntry, queueAnimationLoads, requestMoveAnimation } from '../vfx/anim/moveAnimLoader';
import { getMoveVfxAdjustment } from '../vfx/moveVfxAdjustments';
import { resolveMoveVfxSource } from '../vfx/moveVfxSource';
import { HEAL_COMMON_ANIMATION, STATUS_COMMON_ANIMATIONS, playableFrameCount } from '../../data/moveAnimationFormat';
import { playFallbackFlash } from '../vfx/anim/fallbackFlash';
import { getMoveTypeColor } from '../vfx/typeColor';
import { playMoveSound } from '../sound/moveSound';
import { playBattleMusic } from '../sound/battleMusic';
import { installMasterLimiter } from '../sound/masterBus';
import { teamColorHex } from '../../ui/teamColors';
import type { PmdSpriteIndex, SpriteIndex } from '../../data/types';
import spriteIndexData from '../../data/generated/spriteIndex.json';
import { pmdSpriteIndexUrl } from '../sprites/pmdSheetUrl';

export interface ActionSceneData {
  engine: ActionEngine;
  /** Null for a spectator: no input, no aim line. */
  controller: PlayerController | null;
}

const spriteIndex = spriteIndexData as SpriteIndex;
const PMD_SPRITE_INDEX_KEY = 'pmd-sprite-index';

// Hit reactions. Only hits the player lands or takes freeze the game or shake
// the camera — in an 8-fighter brawl, bots trading blows elsewhere would turn
// that into noise. Every hit still flashes (PokemonSprite's lastHitAtMs),
// squashes, sparks and shows its number.
const HIT_STOP_MS = 55;
const HIT_STOP_CRIT_MS = 110;
const SHAKE_MS = 110;
const SHAKE_DEALT = 0.003;
const SHAKE_TAKEN = 0.007;
const MOVE_LABEL_MS = 700;
const DAMAGE_NUMBER_MS = 750;
const PLAYER_HIT_VIBRATE_MS = 20;
/** Projectiles fade instead of vanishing, so a miss still reads as a shot landing. */
const PROJECTILE_FADE_MS = 120;
/** A move's full pack animation is squeezed into this, so it keeps pace with
 * the shot it rides on — the spectator arena gives it 1.2 s. */
const MOVE_ANIM_MS = 700;
/** How long a finished shot's last position is kept for an animation still flying to it. */
const SHOT_POSITION_TTL_MS = 2000;
const INVULN_ALPHA = 0.5;

// Crowd Calls. Colors are placeholders for the theme pass.
const SHIELD_COLOR = 0x7fd8ff;
const SPEED_TRAIL_COLOR = 0xffe066;
const SPEED_TRAIL_EVERY_MS = 60;
const SPEED_TRAIL_FADE_MS = 260;
const CRATE_BODY_COLOR = 0xb5793a;
const CRATE_EDGE_COLOR = 0x5c3a17;
const CRATE_CROSS_COLOR = 0xffffff;
const CRATE_SIZE = 44;
const CRATE_TEXTURE_KEY = 'crowd-supply-crate';
const BLOCK_TEXT_COLOR = '#7fd8ff';

/** Play Mode's arena: drives the ActionEngine each frame, reads keyboard and
 * mouse into the PlayerController, and draws fighters, shots, aim and hit
 * feedback. The touch controls live in the React HUD (ActionMatchScreen). */
export class ActionScene extends Phaser.Scene {
  private engine!: ActionEngine;
  private controller: PlayerController | null = null;
  private readonly sprites = new Map<string, PokemonSprite>();
  private readonly projectiles = new Map<number, Phaser.GameObjects.Arc>();
  /** Every live (or just-finished) shot's ground position — what a move animation flies along. */
  private readonly shotPositions = new Map<number, Vec2>();
  /** Which sprites are currently drawn see-through for i-frames — set only on change, so it never
   * stomps an animation that fades its own attacker (Fly, Double Team). */
  private readonly invulnShown = new Map<string, boolean>();
  private pmdSpriteIndex: PmdSpriteIndex | null = null;
  private aimGraphics!: Phaser.GameObjects.Graphics;
  private lastActionSeq = 0;
  private lastWallClockMs = 0;
  private stadium: Stadium | null = null;
  private hitStopUntilMs = 0;
  private readonly shieldRings = new Map<string, Phaser.GameObjects.Arc>();
  private readonly lastTrailAtMs = new Map<string, number>();
  private readonly crates = new Map<number, Phaser.GameObjects.Image>();

  constructor() {
    super('Action');
  }

  init(data: ActionSceneData | undefined): void {
    if (!data?.engine) return;
    this.engine = data.engine;
    this.controller = data.controller;
    this.sprites.clear();
    this.projectiles.clear();
    this.shotPositions.clear();
    this.invulnShown.clear();
    this.shieldRings.clear();
    this.lastTrailAtMs.clear();
    this.crates.clear();
    this.lastActionSeq = 0;
    this.hitStopUntilMs = 0;
  }

  preload(): void {
    this.load.json(PMD_SPRITE_INDEX_KEY, pmdSpriteIndexUrl());
    preloadPokeballAsset(this);
    preloadFamilyVfxAssets(this);
    // Every move in the roster is known up front, so the animations download
    // with the arena rather than on first use — same as ArenaScene.
    if (this.engine) {
      const state = this.engine.getState();
      const moveIds = new Set(state.allInstanceIds.flatMap((id) => state.pokemon[id].moves.map((slot) => slot.moveId)));
      queueAnimationLoads(this, moveIds, [...Object.values(STATUS_COMMON_ANIMATIONS), HEAL_COMMON_ANIMATION]);
    }
  }

  create(): void {
    if (!this.engine) return;
    const state = this.engine.getState();
    this.stadium = createStadiumBackground(this, state.arena);
    this.pmdSpriteIndex = (this.cache.json.get(PMD_SPRITE_INDEX_KEY) as PmdSpriteIndex | undefined) ?? null;
    state.livingOrder.forEach((id, index) => this.createSprite(id, index, state));
    this.aimGraphics = this.add.graphics().setDepth(100_000);
    this.buildCrateTexture();
    this.cameras.main.setBackgroundColor('#1a1a1a');
    if (this.controller) this.bindKeyboardAndMouse(this.controller);
    installMasterLimiter(this);
    playBattleMusic(this);
    this.lastWallClockMs = performance.now();
  }

  update(): void {
    if (!this.engine) return;
    const wallNow = performance.now();
    const wallDelta = Math.max(0, wallNow - this.lastWallClockMs);
    this.lastWallClockMs = wallNow;
    this.stadium?.update(wallDelta);
    // Hit-stop: keep drawing, stop simulating — the freeze is what sells the impact.
    if (wallNow >= this.hitStopUntilMs) {
      this.controller?.update();
      this.engine.tick(wallDelta);
    }

    const state = this.engine.getState();
    for (const id of state.livingOrder) {
      const sprite = this.sprites.get(id);
      if (!sprite) continue;
      const pokemon = state.pokemon[id];
      sprite.update(pokemon, pokemon.position.x, pokemon.position.y, state.elapsedMs, state.pokemon);
      const invuln = this.engine.getFighter(id).invulnMs > 0;
      if (this.invulnShown.get(id) !== invuln) {
        this.invulnShown.set(id, invuln);
        sprite.setAnimAlpha(invuln ? INVULN_ALPHA : 1);
      }
      this.drawBuffs(id, sprite, wallNow);
    }
    for (const [id, ring] of this.shieldRings) if (!this.engine.isAlive(id)) ring.setVisible(false);
    this.syncProjectiles();
    this.syncCrates();
    this.drawAim(state);
    for (const event of this.engine.getActionEventsSince(this.lastActionSeq)) {
      this.lastActionSeq = event.seq;
      this.handleEvent(event, state);
    }
  }

  private createSprite(id: string, index: number, state: Readonly<SimState>): void {
    const pokemon = state.pokemon[id];
    const sprite = new PokemonSprite(this, pokemon, spriteIndex, this.pmdSpriteIndex, index, pokemon.shiny);
    sprite.setFollowExact(true);
    if (id === this.engine.playerId) sprite.setHighlighted(true);
    if (state.teams) sprite.setTeamColor(teamColorHex(pokemon.team));
    this.sprites.set(id, sprite);
    this.invulnShown.delete(id);
  }

  private bindKeyboardAndMouse(controller: PlayerController): void {
    const keyboard = this.input.keyboard;
    if (keyboard) {
      const keys = keyboard.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as Record<string, Phaser.Input.Keyboard.Key>;
      keyboard.addCapture('SPACE,SHIFT,TAB,UP,DOWN,LEFT,RIGHT');
      const readMove = (): void => {
        const x = Number(keys.D.isDown || keys.RIGHT.isDown) - Number(keys.A.isDown || keys.LEFT.isDown);
        const y = Number(keys.S.isDown || keys.DOWN.isDown) - Number(keys.W.isDown || keys.UP.isDown);
        const len = Math.hypot(x, y) || 1;
        controller.keyMove = { x: x / len, y: y / len };
      };
      keyboard.on('keydown', (event: KeyboardEvent) => {
        readMove();
        if (event.repeat) return;
        const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
        if (slot >= 0) controller.fire(slot);
        else if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') controller.dash();
        else if (event.code === 'KeyL') controller.toggleLock();
        else if (event.code === 'Tab') controller.cycleTarget();
      });
      keyboard.on('keyup', readMove);
      // Typing in chat mustn't steer the fighter, and Phaser's global key
      // capture would otherwise eat the message's spaces.
      const onFocusChange = (): void => {
        const el = document.activeElement;
        const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
        if (keyboard.manager) keyboard.manager.enabled = !typing;
        if (typing) {
          keyboard.resetKeys();
          controller.keyMove = { x: 0, y: 0 };
        }
      };
      window.addEventListener('focusin', onFocusChange);
      window.addEventListener('focusout', onFocusChange);
      const unbind = (): void => {
        window.removeEventListener('focusin', onFocusChange);
        window.removeEventListener('focusout', onFocusChange);
      };
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, unbind);
      this.events.once(Phaser.Scenes.Events.DESTROY, unbind);
    }

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) controller.mouseAim = { x: pointer.worldX, y: pointer.worldY };
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch || !pointer.leftButtonDown()) return;
      controller.mouseAim = { x: pointer.worldX, y: pointer.worldY };
      controller.fire(0);
    });
  }

  /** Drawn once into a texture: a live Graphics per crate would redraw every frame. */
  private buildCrateTexture(): void {
    if (this.textures.exists(CRATE_TEXTURE_KEY)) return;
    const g = this.make.graphics({}, false);
    const s = CRATE_SIZE;
    g.fillStyle(CRATE_EDGE_COLOR).fillRoundedRect(0, 0, s, s, 6);
    g.fillStyle(CRATE_BODY_COLOR).fillRoundedRect(4, 4, s - 8, s - 8, 4);
    g.fillStyle(CRATE_CROSS_COLOR)
      .fillRect(s / 2 - 4, 10, 8, s - 20)
      .fillRect(10, s / 2 - 4, s - 20, 8);
    g.generateTexture(CRATE_TEXTURE_KEY, s, s);
    g.destroy();
  }

  private syncCrates(): void {
    const live = new Set<number>();
    for (const pickup of this.engine.getPickups()) {
      live.add(pickup.id);
      if (this.crates.has(pickup.id)) continue;
      const crate = this.add.image(pickup.position.x, pickup.position.y, CRATE_TEXTURE_KEY).setDepth(pickup.position.y).setScale(0.3);
      this.tweens.add({ targets: crate, scale: 1, duration: 260, ease: 'Back.easeOut' });
      this.crates.set(pickup.id, crate);
    }
    for (const [id, crate] of this.crates) {
      if (live.has(id)) continue;
      this.crates.delete(id);
      this.tweens.add({ targets: crate, alpha: 0, scale: 1.4, duration: 180, onComplete: () => crate.destroy() });
    }
  }

  /** Crowd Call buffs: a bubble while shielded, fading footprints while sped up. */
  private drawBuffs(id: string, sprite: PokemonSprite, wallNow: number): void {
    const f = this.engine.getFighter(id);
    const at = sprite.getRenderPosition();
    let ring = this.shieldRings.get(id);
    if (f.shieldMs > 0) {
      if (!ring) {
        ring = this.add.circle(0, 0, 10).setStrokeStyle(4, SHIELD_COLOR, 0.9).setFillStyle(SHIELD_COLOR, 0.15);
        this.shieldRings.set(id, ring);
      }
      ring
        .setRadius(sprite.getOnScreenSize() * 0.55)
        .setPosition(at.x, at.y - sprite.bodyCenterLift())
        .setDepth(at.y + 2)
        .setVisible(true);
    } else ring?.setVisible(false);

    if (f.speedMs > 0 && wallNow - (this.lastTrailAtMs.get(id) ?? 0) >= SPEED_TRAIL_EVERY_MS) {
      this.lastTrailAtMs.set(id, wallNow);
      const puff = this.add.circle(at.x, at.y, 14, SPEED_TRAIL_COLOR, 0.55).setDepth(at.y - 1);
      this.tweens.add({ targets: puff, alpha: 0, scale: 0.3, duration: SPEED_TRAIL_FADE_MS, onComplete: () => puff.destroy() });
    }
  }

  private syncProjectiles(): void {
    const live = new Set<number>();
    for (const p of this.engine.getProjectiles()) {
      live.add(p.id);
      this.shotPositions.set(p.id, { ...p.position });
      let orb = this.projectiles.get(p.id);
      if (!orb) {
        // A faint ground marker under the move animation: it's the real hitbox, so dodging stays readable.
        orb = this.add.circle(p.position.x, p.position.y, p.radius * 0.6, getMoveTypeColor(p.type), 0.45);
        orb.setStrokeStyle(2, 0xffffff, 0.5);
        this.projectiles.set(p.id, orb);
      }
      orb.setPosition(p.position.x, p.position.y).setDepth(p.position.y + 1);
    }
    for (const [id, orb] of this.projectiles) {
      if (live.has(id)) continue;
      this.projectiles.delete(id);
      this.time.delayedCall(SHOT_POSITION_TTL_MS, () => this.shotPositions.delete(id));
      this.tweens.add({ targets: orb, alpha: 0, scale: 1.8, duration: PROJECTILE_FADE_MS, onComplete: () => orb.destroy() });
    }
  }

  /** The player's aim: a reticle on the lock-on target, else a line to the
   * mouse or to wherever a touch move button is being dragged. */
  private drawAim(state: Readonly<SimState>): void {
    const g = this.aimGraphics;
    g.clear();
    const controller = this.controller;
    const self = state.pokemon[this.engine.playerId];
    if (!controller || !this.engine.isAlive(this.engine.playerId) || state.phase !== 'battle') return;
    const target = controller.lockOn && controller.lockTargetId ? state.pokemon[controller.lockTargetId] : undefined;
    if (target && !controller.dragAim) {
      const r = target.collisionRadius + 16;
      const spin = (state.elapsedMs / 400) % (Math.PI * 2);
      g.lineStyle(4, 0xffffff, 0.9);
      for (let i = 0; i < 4; i++) {
        const a = spin + (i * Math.PI) / 2;
        g.beginPath();
        g.arc(target.position.x, target.position.y, r, a, a + Math.PI / 4);
        g.strokePath();
      }
      return;
    }
    const aim = controller.aimPoint(controller.dragAim);
    g.lineStyle(3, 0xffffff, 0.45);
    g.lineBetween(self.position.x, self.position.y, aim.x, aim.y);
    if (controller.mouseAim && !controller.dragAim) {
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(aim.x, aim.y, 14);
      g.lineBetween(aim.x - 22, aim.y, aim.x + 22, aim.y);
      g.lineBetween(aim.x, aim.y - 22, aim.x, aim.y + 22);
    }
  }

  private handleEvent(event: ActionEvent, state: Readonly<SimState>): void {
    const playerId = this.engine.playerId;
    switch (event.type) {
      case 'fired': {
        const sprite = this.sprites.get(event.attackerId);
        const move = this.engine.getMove(event.moveId);
        if (!sprite || !move) return;
        sprite.playPmdAttack(event.origin, event.kind === 'self' ? undefined : event.aim, event.kind !== 'physical');
        const hideLabel = sprite.showMoveLabel(move);
        this.time.delayedCall(MOVE_LABEL_MS, hideLabel);
        if (event.attackerId === playerId) playMoveSound(this, move);
        if (event.kind === 'aoe') this.playAoeRing(event.origin.x, event.origin.y, getMoveTypeColor(move.type));
        if (!event.failed) this.playMoveAnimation(event, move, sprite);
        return;
      }
      case 'hit':
        this.playHitReaction(event);
        this.stadium?.cheer(0.3 + (event.crit ? 0.3 : 0) + (event.effectiveness > 1 ? 0.2 : 0));
        return;
      case 'dashed':
        playFallbackFlash(this, event.from.x, event.from.y, 'normal');
        return;
      case 'ko': {
        const sprite = this.sprites.get(event.instanceId);
        sprite?.playFaintAndDestroy(() => {
          if (this.sprites.get(event.instanceId) === sprite) this.sprites.delete(event.instanceId);
        });
        if (event.instanceId === playerId || event.byInstanceId === playerId) this.cameras.main.shake(220, SHAKE_TAKEN);
        this.stadium?.cheer(1);
        return;
      }
      case 'respawned':
        this.sprites.get(event.instanceId)?.destroy();
        this.createSprite(event.instanceId, 0, state);
        return;
      case 'item':
        this.sprites.get(event.instanceId)?.playHealVfx(event.amount);
        this.stadium?.cheer(0.6);
        return;
      case 'pickupTaken':
        this.sprites.get(event.instanceId)?.playHealVfx(event.amount);
        return;
      case 'crowdCall':
        this.stadium?.cheer(0.8);
        return;
    }
  }

  /** The move's real animation — the pack's, or the arena's own family VFX —
   * as ArenaScene picks it (see moveVfxSource.ts), except the far end is the
   * shot itself rather than a target known up front: it follows the shot in
   * flight and settles where the shot ended. */
  private playMoveAnimation(event: Extract<ActionEvent, { type: 'fired' }>, move: MoveDefinition, sprite: PokemonSprite): void {
    const entry = getMoveAnimationEntry(move.id);
    const adjustment = getMoveVfxAdjustment(move.id);
    const source = resolveMoveVfxSource(move, entry, adjustment);
    const lift = sprite.bodyCenterLift();
    const restingEnd = shotEndPoint(event);
    const groundTarget = (): Vec2 => (event.projectileId !== null ? this.shotPositions.get(event.projectileId) : undefined) ?? restingEnd;

    if (source.kind === 'family') {
      if (event.kind === 'self') return; // family VFX are attacker-to-target effects; a buff shows pose/label only
      const bodyCenter = adjustment?.familyAnchor ? adjustment.familyAnchor === 'center' : familyAnchorsAtBodyCenter(source.family);
      const from = bodyCenter ? { x: event.origin.x, y: event.origin.y - lift } : event.origin;
      const to = bodyCenter ? { x: restingEnd.x, y: restingEnd.y - lift } : restingEnd;
      playFamilyVfx(this, source.family, from, to, PROJECTILE.ranged.radius, move.type, sprite, {
        x: restingEnd.x,
        y: restingEnd.y - lift,
      });
      return;
    }

    const loaded = getLoadedMoveAnimation(this, move.id);
    if (!loaded) {
      // Not downloaded yet: the shot's ground marker and impact burst carry this one.
      requestMoveAnimation(this, move.id);
      return;
    }
    const fallback = sprite.getAnimAnchor();
    const getAttacker = (): Vec2 => (sprite.isDestroyed() ? fallback : sprite.getAnimAnchor());
    const getTarget = (): Vec2 => {
      if (event.kind === 'self') return getAttacker();
      const ground = groundTarget();
      return { x: ground.x, y: ground.y - lift };
    };
    playAnimation({
      scene: this,
      data: loaded.data,
      sheetKey: loaded.sheetKey,
      getAttacker,
      getTarget,
      getAttackerDepth: () => (sprite.isDestroyed() ? event.origin.y : sprite.getRenderPosition().y),
      getTargetDepth: () => (event.kind === 'self' ? sprite.getRenderPosition().y : groundTarget().y),
      scale: animationScaleFor(sprite.getOnScreenSize()) * (adjustment?.scale ?? 1),
      cellOffset: adjustment?.offset,
      dropCells: adjustment?.dropCells,
      dropPatterns: adjustment?.dropPatterns,
      screenAnchor: adjustment?.screenAnchor,
      upright: adjustment?.upright,
      patternCycle: adjustment?.patternCycle,
      msPerFrame: frameDurationMs(playableFrameCount(loaded.data.frames), MOVE_ANIM_MS, adjustment?.playbackSpeed),
      attacker: sprite,
    });
  }

  private playHitReaction(event: Extract<ActionEvent, { type: 'hit' }>): void {
    const move = this.engine.getMove(event.moveId);
    const target = this.sprites.get(event.targetId);
    const playerId = this.engine.playerId;
    const taken = event.targetId === playerId;
    const dealt = event.attackerId === playerId;
    const big = event.crit || event.effectiveness > 1;

    if (move) playImpactBurst(this, event.position.x, event.position.y - (target?.bodyCenterLift() ?? 0), move.type);
    if (event.damage > 0) target?.playSquash(big ? 1.6 : 1);
    if (target && !target.isDestroyed()) this.showDamageNumber(event, target, taken);
    if (taken || dealt) {
      this.hitStopUntilMs = performance.now() + (big ? HIT_STOP_CRIT_MS : HIT_STOP_MS);
      this.cameras.main.shake(SHAKE_MS, (taken ? SHAKE_TAKEN : SHAKE_DEALT) * (big ? 1.6 : 1));
      if (move && taken) playMoveSound(this, move);
    }
    if (taken) navigator.vibrate?.(PLAYER_HIT_VIBRATE_MS);
  }

  private showDamageNumber(event: Extract<ActionEvent, { type: 'hit' }>, target: PokemonSprite, taken: boolean): void {
    let text = String(event.damage);
    let color = taken ? '#ff6b6b' : '#ffffff';
    let size = 22;
    if (event.blocked) {
      text = 'BLOCK';
      color = BLOCK_TEXT_COLOR;
    } else if (event.effectiveness === 0) {
      text = 'IMMUNE';
      color = '#bbbbbb';
    } else if (event.damage === 0) {
      return; // a status move landing — its effect shows on the sprite itself
    } else if (event.crit) {
      text = `CRIT ${event.damage}`;
      color = '#ffd479';
      size = 30;
    } else if (event.effectiveness > 1) {
      text = `${event.damage}!`;
      size = 27;
    } else if (event.effectiveness < 1) {
      color = taken ? '#e89a9a' : '#bbbbbb';
      size = 18;
    }
    const anchor = target.getAnimAnchor();
    const label = this.add
      .text(anchor.x + Phaser.Math.Between(-14, 14), anchor.y - target.getOnScreenSize() * 0.45, text, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: `${size}px`,
        color,
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(100_001)
      .setScale(1.4);
    this.tweens.add({ targets: label, scale: 1, duration: 90, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: label,
      y: label.y - 60,
      alpha: 0,
      delay: DAMAGE_NUMBER_MS * 0.4,
      duration: DAMAGE_NUMBER_MS * 0.6,
      onComplete: () => label.destroy(),
    });
  }

  private playAoeRing(x: number, y: number, color: number): void {
    const ring = this.add
      .circle(x, y, 20)
      .setStrokeStyle(8, color, 0.9)
      .setFillStyle(color, 0.18)
      .setDepth(y - 1);
    this.tweens.add({
      targets: ring,
      radius: AOE_RADIUS,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy(),
    });
  }
}

/** Where a fired move comes to rest if nothing stops it: its shot's full range
 * toward the aim (or the aim itself, if closer), or the edge of a burst. */
function shotEndPoint(event: Extract<ActionEvent, { type: 'fired' }>): Vec2 {
  if (event.kind === 'self') return event.origin;
  const reach = event.kind === 'aoe' ? AOE_RADIUS : event.kind === 'physical' ? PROJECTILE.physical.range : PROJECTILE.ranged.range;
  const dx = event.aim.x - event.origin.x;
  const dy = event.aim.y - event.origin.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return event.origin;
  const t = Math.min(d, reach) / d;
  return { x: event.origin.x + dx * t, y: event.origin.y + dy * t };
}
