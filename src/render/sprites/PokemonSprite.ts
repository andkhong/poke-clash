import Phaser from 'phaser';
import type { PokemonInstance, StatusCondition } from '../../sim/types';
import type { SpriteIndex } from '../../data/types';
import { downgradeTier, resolveSpriteUrls, type SpriteUrls } from './spriteResolver';
import { loadGifAsAnimatedTexture } from './gifTexture';
import { getMoveTypeColor } from '../vfx/typeColor';
import type { MoveDefinition } from '../../sim/types';

const HP_BAR_WIDTH = 40;
const HP_BAR_HEIGHT = 5;
const HIT_FLASH_MS = 160;
const MOVE_LABEL_MS = 1300;
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

/** One on-field Pokémon's complete visual presentation: body sprite, HP bar,
 * status icon, and transient move-name callout. Reads from a PokemonInstance
 * snapshot each frame; owns no simulation state itself. */
export class PokemonSprite {
  readonly instanceId: string;

  private readonly scene: Phaser.Scene;
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
  private facingIsSouthOrNorth = true;
  private hasFainted = false;
  private idleTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, pokemon: PokemonInstance, spriteIndex: SpriteIndex | null) {
    this.scene = scene;
    this.instanceId = pokemon.instanceId;

    this.container = scene.add.container(pokemon.position.x, pokemon.position.y);
    this.container.setDepth(pokemon.position.y);

    this.placeholder = scene.add.circle(0, 0, 14, 0xcccccc).setStrokeStyle(2, 0x888888);
    this.container.add(this.placeholder);

    this.hpBarBg = scene.add
      .rectangle(0, 22, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x1a1a1a, 0.85)
      .setOrigin(0.5, 0.5);
    this.hpBarFill = scene.add
      .rectangle(-HP_BAR_WIDTH / 2, 22, HP_BAR_WIDTH, HP_BAR_HEIGHT - 1.5, 0x4caf50)
      .setOrigin(0, 0.5);
    this.container.add([this.hpBarBg, this.hpBarFill]);

    this.statusText = scene.add
      .text(0, -26, '', { fontSize: '9px', fontFamily: 'monospace', fontStyle: 'bold' })
      .setOrigin(0.5, 0.5)
      .setPadding(2, 1, 2, 1);
    this.statusText.setVisible(false);
    this.container.add(this.statusText);

    void this.loadSprites(pokemon, spriteIndex);
  }

  private async loadSprites(pokemon: PokemonInstance, spriteIndex: SpriteIndex | null): Promise<void> {
    const initial = resolveSpriteUrls(pokemon.speciesId, pokemon.name, spriteIndex);
    await this.tryLoadTier(pokemon, initial);
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

  private loadStaticImage(key: string, url: string): Promise<boolean> {
    if (this.scene.textures.exists(key)) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.scene.load.image(key, url);
      this.scene.load.once(`filecomplete-image-${key}`, () => resolve(true));
      this.scene.load.once('loaderror', (file: { key: string }) => {
        if (file.key === key) resolve(false);
      });
      if (!this.scene.load.isLoading()) this.scene.load.start();
    });
  }

  private onSpritesReady(frontKey: string, backKey: string): void {
    if (this.container.scene === undefined) return; // destroyed while loading
    this.placeholder.setVisible(false);

    const sprite = this.scene.add.sprite(0, 0, frontKey).setOrigin(0.5, 0.7);
    sprite.setData('frontKey', frontKey);
    sprite.setData('backKey', backKey);
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
    this.container.setPosition(screenX, screenY);
    this.container.setDepth(screenY);

    this.updateFacing(pokemon);
    this.updateHpBar(pokemon);
    this.updateStatus(pokemon);
    this.updateHitFlash(pokemon, nowMs);
    this.updateMoveLabel(nowMs);
  }

  private updateFacing(pokemon: PokemonInstance): void {
    if (!this.body) return;
    const wantsSouthOrNorth = pokemon.facing === 'N' || pokemon.facing === 'S';

    if (wantsSouthOrNorth !== this.facingIsSouthOrNorth || this.body.texture.key === '') {
      const key = pokemon.facing === 'N' ? this.body.getData('backKey') : this.body.getData('frontKey');
      const isAnimated = pokemon.facing === 'N' ? this.backIsAnimated : this.frontIsAnimated;
      if (this.body instanceof Phaser.GameObjects.Sprite) {
        this.body.setTexture(key);
        if (isAnimated) this.body.play({ key, repeat: -1 }, true);
      }
      this.facingIsSouthOrNorth = wantsSouthOrNorth;
    }

    // East/West both reuse the front (South) texture, mirrored — only swap
    // away from a North (back) texture when actually leaving north-facing.
    if (pokemon.facing !== 'N' && this.body.texture.key !== this.body.getData('frontKey')) {
      const key = this.body.getData('frontKey');
      if (this.body instanceof Phaser.GameObjects.Sprite) {
        this.body.setTexture(key);
        if (this.frontIsAnimated) this.body.play({ key, repeat: -1 }, true);
      }
    }

    this.body.setFlipX(pokemon.facing === 'E');
  }

  private updateHpBar(pokemon: PokemonInstance): void {
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
    }
    this.scene.tweens.add({
      targets: this.container,
      x: this.container.x + Phaser.Math.Between(-4, 4),
      duration: 40,
      yoyo: true,
      repeat: 2,
    });
  }

  showMoveLabel(move: MoveDefinition): void {
    this.moveLabel?.destroy();
    const color = getMoveTypeColor(move.type);
    const text = this.scene.add
      .text(0, 0, move.name.toUpperCase(), { fontSize: '9px', fontFamily: 'monospace', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5, 0.5)
      .setPadding(4, 2, 4, 2);
    const bg = this.scene.add.rectangle(0, 0, text.width + 8, text.height + 4, color, 0.92).setStrokeStyle(1, 0x000000, 0.3);
    this.moveLabel = this.scene.add.container(0, -38, [bg, text]);
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
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scale: 0.6,
      duration: 500,
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
