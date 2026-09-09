import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildBeamParticleTexture, lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Ice Beam/Hydro Pump/Thunderbolt/Flamethrower-style VFX (see
 * moveAnimations.ts) — a charge glow at the attacker, a beam that extends
 * frame-by-frame toward the target with trailing shard particles (rather
 * than the legacy playMoveImpact's instantly-drawn line), then an impact
 * ring + sparkle burst. The attacker's own position is never touched here —
 * these moves keep the caster stationary, matching the reference footage.
 *
 * The beam itself is drawn as two stacked strokes: a wide, additively-blended
 * outer glow for bloom, plus a solid (non-additive, near-opaque) near-white
 * inner core so it reads as a chunky physical laser rather than a faint tint
 * — measured directly against the reference video, the beam there is ~14%
 * of the caster's own sprite width, which is why this needs to be wide in
 * absolute pixels (Pokémon sprites here render at 84-270px). */
const CHARGE_DURATION_MS = 120;
const EXTEND_DURATION_MS = 200;
const BEAM_OUTER_WIDTH = 34;
const BEAM_INNER_WIDTH = 16;
const RING_DURATION_MS = 260;

/** Real cropped art (see public/move-assets/beam/README.md) — a glowing
 * stacked-orb charge column, replacing the plain charge-glow circle at the
 * attacker. Unlike most other real-asset families, this one IS tinted per
 * move type at runtime (the source art is near-white/yellow specifically so
 * it takes a tint cleanly) — 'beam' is the shared default for most special
 * moves across many types, so a single fixed color would be wrong most of
 * the time, unlike e.g. iceShard/bubble/leaf's single-type callers. */
export const BEAM_CHARGE_TEXTURE_KEY = 'vfx-beam-charge-column';
export function preloadBeamVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(BEAM_CHARGE_TEXTURE_KEY, '/move-assets/beam/column.png');
}
// column.png is native 30x191 (tall) — scaled down to a ~65px on-screen
// height so the charge reads as a quick glow at the attacker's feet, same
// on-screen scale as the circle it replaces (which grew to a 60px diameter),
// not a dominating pillar.
const CHARGE_TARGET_HEIGHT_PX = 65;
const CHARGE_NATIVE_HEIGHT_PX = 191;
const CHARGE_SCALE = CHARGE_TARGET_HEIGHT_PX / CHARGE_NATIVE_HEIGHT_PX;

export function playBeamAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const coreColor = lighten(color, 0.65);
  const particleKey = buildBeamParticleTexture(scene, color);

  scene.textures.get(BEAM_CHARGE_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);
  const charge = scene.add
    .image(fromX, fromY, BEAM_CHARGE_TEXTURE_KEY)
    .setOrigin(0.5, 1) // anchored at the attacker's feet, same as hydroPumpAttack.ts's pillar
    .setDepth(499)
    .setTint(coreColor)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(CHARGE_SCALE, CHARGE_SCALE * 0.15)
    .setAlpha(0);
  scene.tweens.add({
    targets: charge,
    scaleY: CHARGE_SCALE,
    alpha: 0.95,
    duration: CHARGE_DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => {
      // Fades out on its own short tail, overlapping the beam's own travel
      // (fired next, on the same CHARGE_DURATION_MS timer below) rather than
      // blocking it — same overlap reasoning as hydroPumpAttack.ts's pillar.
      scene.tweens.add({ targets: charge, alpha: 0, duration: 100, onComplete: () => charge.destroy() });
    },
  });

  scene.time.delayedCall(CHARGE_DURATION_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    // Two separate Graphics objects rather than one — Phaser applies a
    // single blend mode to an entire Graphics object, and the glow (additive,
    // for bloom) and the core (normal-blended, near-opaque, for a solid
    // silhouette) need different ones.
    const outer = scene.add.graphics().setDepth(499).setBlendMode(Phaser.BlendModes.ADD);
    const inner = scene.add.graphics().setDepth(500);
    const progress = { t: 0 };
    scene.tweens.add({
      targets: progress,
      t: 1,
      duration: EXTEND_DURATION_MS,
      ease: 'Sine.easeOut',
      onUpdate: () => {
        const headX = Phaser.Math.Linear(fromX, toX, progress.t);
        const headY = Phaser.Math.Linear(fromY, toY, progress.t);
        outer.clear();
        outer.lineStyle(BEAM_OUTER_WIDTH, color, 0.55);
        outer.lineBetween(fromX, fromY, headX, headY);
        inner.clear();
        inner.lineStyle(BEAM_INNER_WIDTH, coreColor, 1);
        inner.lineBetween(fromX, fromY, headX, headY);
        spawnTrailShard(scene, fromX, fromY, toX, toY, Math.max(0, progress.t - 0.12), particleKey);
      },
      onComplete: () => {
        scene.tweens.add({ targets: [outer, inner], alpha: 0, duration: 180, onComplete: () => { outer.destroy(); inner.destroy(); } });
        playBeamImpactRing(scene, toX, toY, color, coreColor);
        playImpactBurst(scene, toX, toY, type);
      },
    });
  });
}

/** Spawns a fading shard a short distance behind the beam's current tip,
 * giving it the trailing-particle texture seen in the reference rather than
 * a flat, featureless line. */
function spawnTrailShard(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  trailT: number,
  textureKey: string
): void {
  if (Math.random() > 0.8) return;
  const x = Phaser.Math.Linear(fromX, toX, trailT);
  const y = Phaser.Math.Linear(fromY, toY, trailT);
  const shard = scene.add
    .image(x, y, textureKey)
    .setScale(2.2)
    .setDepth(502)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({ targets: shard, alpha: 0, scale: 3, duration: 220, onComplete: () => shard.destroy() });
}

function playBeamImpactRing(scene: Phaser.Scene, x: number, y: number, color: number, coreColor: number): void {
  const ring = scene.add.circle(x, y, 10, color, 0.55).setDepth(501).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: ring,
    radius: 54,
    alpha: 0,
    duration: RING_DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });

  const flash = scene.add.circle(x, y, 20, coreColor, 0.95).setDepth(502).setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: flash,
    radius: 4,
    alpha: 0,
    duration: 160,
    ease: 'Cubic.easeIn',
    onComplete: () => flash.destroy(),
  });
}
