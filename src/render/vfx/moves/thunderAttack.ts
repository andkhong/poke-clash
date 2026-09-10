import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildThunderParticleTexture, lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Thunderbolt/Thunder Shock/Thunder-style VFX (see moveAnimations.ts's
 * electric-type routing) — a jagged bolt that flickers between the attacker
 * and target rather than playBeamAttack's smooth, steadily-extending laser
 * line, since a straight beam reads as "generic special move," not
 * "electric." Real lightning doesn't crawl toward its target either — it
 * flashes — so this redraws the zigzag (re-jittered each time, for a
 * crackling look) twice in quick succession instead of animating a
 * travelling head. Caster stays stationary, same as the rest of the beam
 * family.
 */
const CHARGE_DURATION_MS = 90;
const FLICKER_ON_MS = 55;
const FLICKER_OFF_MS = 40;
const ZIGZAG_SEGMENTS = 5;
const ZIGZAG_JITTER_PX = 22;
const BOLT_OUTER_WIDTH = 10;
const BOLT_INNER_WIDTH = 4;
const PARTICLES_PER_FLICKER = 3;

/** Real cropped art (see public/move-assets/thunder/README.md) — a
 * lightning-strike frame (jagged bolt flashing through a ghost-face flare),
 * shown as a brief flourish at the impact point alongside playBoltFlash's
 * existing procedural glow, rather than replacing the whole travel path
 * (which still needs to stretch to any attacker-target distance, unlike
 * this fixed-shape sprite). */
export const THUNDER_BOLT_TEXTURE_KEY = 'vfx-thunder-bolt';
export function preloadThunderVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(THUNDER_BOLT_TEXTURE_KEY, '/move-assets/thunder/bolt.png');
}
const BOLT_FLOURISH_MS = 220;
// bolt.png is native 31x160 (tall) — scaled down to a ~90-120px on-screen
// height so it reads as a flourish alongside the impact flash, not something
// bigger than the Pokémon it's striking (84-270px sprites).
const BOLT_FLOURISH_START_SCALE = 0.55;
const BOLT_FLOURISH_END_SCALE = 0.75;

export function playThunderAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const coreColor = lighten(color, 0.75);
  const particleKey = buildThunderParticleTexture(scene, color);

  const charge = scene.add
    .circle(fromX, fromY, 6, coreColor, 0.95)
    .setDepth(499)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: charge,
    radius: 16,
    alpha: 0,
    duration: CHARGE_DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => charge.destroy(),
  });

  scene.time.delayedCall(CHARGE_DURATION_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)

    const outer = scene.add.graphics().setDepth(499).setBlendMode(Phaser.BlendModes.ADD);
    const inner = scene.add.graphics().setDepth(500);

    const flash = (): void => {
      const path = buildZigzagPath(fromX, fromY, toX, toY);
      outer.clear();
      outer.lineStyle(BOLT_OUTER_WIDTH, color, 0.5);
      strokePath(outer, path);
      inner.clear();
      inner.lineStyle(BOLT_INNER_WIDTH, coreColor, 1);
      strokePath(inner, path);
      for (let i = 0; i < PARTICLES_PER_FLICKER; i++) spawnBoltParticle(scene, path, particleKey);
    };
    const hide = (): void => {
      outer.clear();
      inner.clear();
    };
    const finish = (): void => {
      outer.destroy();
      inner.destroy();
      if (!scene.sys.isActive()) return;
      playImpactBurst(scene, toX, toY, type);
      playBoltFlash(scene, toX, toY, coreColor);
      playBoltFlourish(scene, toX, toY);
    };

    // Two quick flickers reads as an electric crackle rather than one static
    // stroke.
    flash();
    scene.time.delayedCall(FLICKER_ON_MS, () => {
      if (!scene.sys.isActive()) return finish();
      hide();
      scene.time.delayedCall(FLICKER_OFF_MS, () => {
        if (!scene.sys.isActive()) return finish();
        flash();
        scene.time.delayedCall(FLICKER_ON_MS, finish);
      });
    });
  });
}

/** Real bolt.png flourish at the strike point — see THUNDER_BOLT_TEXTURE_KEY's
 * own comment. Anchored bottom-center so it reads as striking down into the
 * target regardless of the actual attacker-target angle, same reasoning as
 * playBoltFlash's direction-agnostic flash circle. */
function playBoltFlourish(scene: Phaser.Scene, x: number, y: number): void {
  scene.textures.get(THUNDER_BOLT_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const sprite = scene.add
    .image(x, y, THUNDER_BOLT_TEXTURE_KEY)
    .setOrigin(0.5, 0.85)
    .setScale(BOLT_FLOURISH_START_SCALE)
    .setAlpha(0.95)
    .setDepth(503)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: sprite,
    scale: BOLT_FLOURISH_END_SCALE,
    alpha: 0,
    duration: BOLT_FLOURISH_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => sprite.destroy(),
  });
}

/** A jagged attacker-to-target path: fixed endpoints, with each interior
 * point offset perpendicular to the straight line by a random amount that
 * tapers toward both ends (via a sine window) so the bolt actually meets the
 * attacker and target instead of visibly missing them. */
function buildZigzagPath(fromX: number, fromY: number, toX: number, toY: number): Phaser.Math.Vector2[] {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const perpX = -dy / dist;
  const perpY = dx / dist;

  const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(fromX, fromY)];
  for (let i = 1; i < ZIGZAG_SEGMENTS; i++) {
    const t = i / ZIGZAG_SEGMENTS;
    const taper = Math.sin(t * Math.PI);
    const offset = (Math.random() - 0.5) * 2 * ZIGZAG_JITTER_PX * taper;
    points.push(
      new Phaser.Math.Vector2(
        Phaser.Math.Linear(fromX, toX, t) + perpX * offset,
        Phaser.Math.Linear(fromY, toY, t) + perpY * offset
      )
    );
  }
  points.push(new Phaser.Math.Vector2(toX, toY));
  return points;
}

function strokePath(g: Phaser.GameObjects.Graphics, points: readonly Phaser.Math.Vector2[]): void {
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.strokePath();
}

function spawnBoltParticle(scene: Phaser.Scene, path: readonly Phaser.Math.Vector2[], textureKey: string): void {
  const point = path[Phaser.Math.Between(1, path.length - 2)] ?? path[0];
  const spark = scene.add
    .image(point.x, point.y, textureKey)
    .setScale(1.2 + Math.random() * 1.2)
    .setAngle(Phaser.Math.Between(0, 359))
    .setAlpha(0.9)
    .setDepth(501)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: spark,
    alpha: 0,
    duration: 140 + Math.random() * 80,
    onComplete: () => spark.destroy(),
  });
}

function playBoltFlash(scene: Phaser.Scene, x: number, y: number, coreColor: number): void {
  const flashCircle = scene.add.circle(x, y, 22, coreColor, 0.95).setDepth(502).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: flashCircle,
    radius: 4,
    alpha: 0,
    duration: 150,
    ease: 'Cubic.easeIn',
    onComplete: () => flashCircle.destroy(),
  });
}
