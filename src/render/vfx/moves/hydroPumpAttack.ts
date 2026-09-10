import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { playImpactBurst } from './impactBurst';

export const WATER_PILLAR_TEXTURE_KEY = 'vfx-water-pillar';
/** Native size of pillar.png (public/move-assets/water/pillar.png) — a tall,
 * narrow twisted water column, authored to stand upright. See
 * WATER_BEAM_THICKNESS_PX's own comment for how this gets reused sideways as
 * a traveling beam. */
const WATER_PILLAR_NATIVE_WIDTH = 14;

/** Preloads the one real hand-drawn asset this family uses — a twisted
 * water-column frame cropped from a ripped Pokémon FireRed/LeafGreen
 * attack-effects sheet (public/move-assets/water/README.md has the source).
 * Same "real art needs an explicit preload, unlike the procedural textures
 * that build themselves lazily" reasoning as poisonAttack.ts's globule. */
export function preloadHydroPumpVfxAssets(scene: Phaser.Scene): void {
  scene.load.image(WATER_PILLAR_TEXTURE_KEY, '/move-assets/water/pillar.png');
}

const PILLAR_RISE_MS = 200;
const PILLAR_HOLD_MS = 60;
const PILLAR_FADE_MS = 120;
const PILLAR_SCALE = 2.6;

const BEAM_EXTEND_MS = 200;
/** On-screen thickness (px) of the traveling beam. The pillar art is tiled
 * across this via tileScaleX so exactly one copy of its native width spans
 * it — see playWaterBeamTravel. */
const WATER_BEAM_THICKNESS_PX = 30;
const WATER_BEAM_GLOW_WIDTH_PX = 46;
/** How fast (px/s) the tiled texture scrolls along the beam's length, for a
 * "water actually flowing toward the target" look rather than a static
 * tiled stamp. */
const WATER_BEAM_FLOW_SPEED = 260;
const WATER_BEAM_FLOW_TICK_MS = 16;

/** Hydro Pump/Hydro Cannon-style VFX (see moveAnimations.ts's override) — a
 * twisted water column erupts upward at the attacker just before the beam
 * fires, using the real cropped sprite above instead of beamAttack.ts's
 * plain charge-glow circle, then hands off to playWaterBeamTravel below —
 * the same pillar art tiled sideways to actually form the beam traveling to
 * the target, instead of beamAttack.ts's flat colored line. Caster stays
 * stationary, same as the rest of the beam family. */
export function playHydroPumpAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const pillar = scene.add
    .image(fromX, fromY, WATER_PILLAR_TEXTURE_KEY)
    .setOrigin(0.5, 1) // anchored at the attacker's feet, so it grows upward from the ground
    .setDepth(499)
    .setScale(PILLAR_SCALE, 0.15)
    .setAlpha(0);
  scene.tweens.add({
    targets: pillar,
    scaleY: PILLAR_SCALE,
    alpha: 1,
    duration: PILLAR_RISE_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => {
      scene.time.delayedCall(PILLAR_HOLD_MS, () => {
        if (!scene.sys.isActive()) {
          pillar.destroy();
          return;
        }
        scene.tweens.add({
          targets: pillar,
          alpha: 0,
          duration: PILLAR_FADE_MS,
          onComplete: () => pillar.destroy(),
        });
      });
    },
  });

  // Fires the beam a little before the pillar fully fades, so the two
  // overlap rather than leaving a gap where nothing's happening.
  scene.time.delayedCall(Math.max(0, PILLAR_RISE_MS + PILLAR_HOLD_MS - 40), () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    playWaterBeamTravel(scene, fromX, fromY, toX, toY, type);
  });
}

/** The actual attacker-to-target travel, replacing beamAttack.ts's flat
 * colored line with the same pillar art as above, laid on its side. The
 * pillar texture is authored as a vertical bar (tall/narrow — see
 * WATER_PILLAR_NATIVE_WIDTH), so rather than fight that orientation, the
 * TileSprite is built as a vertical bar too (width = beam thickness, height =
 * beam length, origin pinned to the attacker) and the whole object is
 * rotated to point at the target — its local "down" axis (where the bar
 * grows from origin) ends up aiming at the target regardless of the actual
 * on-screen angle. tileScaleX is set so exactly one copy of the texture's
 * native width spans the beam's thickness (no seam across it), while
 * tilePositionY keeps scrolling for as long as the beam is on screen so the
 * water reads as flowing toward the target rather than a static tiled
 * stamp. A soft additive glow line underneath (same two-layer "glow behind a
 * solid core" shape as beamAttack.ts's outer/inner strokes) keeps it reading
 * as an energetic attack rather than a flat sprite cutout. */
function playWaterBeamTravel(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy) || 1;
  // A vertical bar's local "down" (+Y) direction sits at 90° in Phaser's
  // angle system (0° = local +X, pointing right) — so rotating it by the
  // target direction's own angle minus 90° swings that local +Y to point at
  // the target instead.
  const angleDeg = Phaser.Math.RadToDeg(Math.atan2(dy, dx)) - 90;
  const tileScale = WATER_BEAM_THICKNESS_PX / WATER_PILLAR_NATIVE_WIDTH;

  scene.textures.get(WATER_PILLAR_TEXTURE_KEY).setFilter(Phaser.Textures.FilterMode.NEAREST);

  const glow = scene.add.graphics().setDepth(499).setBlendMode(Phaser.BlendModes.ADD);
  const beam = scene.add
    .tileSprite(fromX, fromY, WATER_BEAM_THICKNESS_PX, 0, WATER_PILLAR_TEXTURE_KEY)
    .setOrigin(0.5, 0)
    .setAngle(angleDeg)
    .setDepth(500)
    .setTileScale(tileScale, tileScale);

  const progress = { t: 0 };
  scene.tweens.add({
    targets: progress,
    t: 1,
    duration: BEAM_EXTEND_MS,
    ease: 'Sine.easeOut',
    onUpdate: () => {
      beam.setSize(WATER_BEAM_THICKNESS_PX, distance * progress.t);
      const headX = Phaser.Math.Linear(fromX, toX, progress.t);
      const headY = Phaser.Math.Linear(fromY, toY, progress.t);
      glow.clear();
      glow.lineStyle(WATER_BEAM_GLOW_WIDTH_PX, color, 0.35);
      glow.lineBetween(fromX, fromY, headX, headY);
    },
    onComplete: () => {
      scene.tweens.add({
        targets: [beam, glow],
        alpha: 0,
        duration: 180,
        onComplete: () => {
          beam.destroy();
          glow.destroy();
        },
      });
      playImpactBurst(scene, toX, toY, type);
    },
  });

  // Scrolls independently of the extend tween above (which only runs while
  // the beam is still growing) so the water keeps visibly flowing for the
  // beam's whole time on screen, not just its growth phase.
  const flowTimer = scene.time.addEvent({
    delay: WATER_BEAM_FLOW_TICK_MS,
    loop: true,
    callback: () => {
      // The fade-out tween (above) can destroy `beam` slightly before this
      // timer's own removal below fires — guard rather than tick a
      // destroyed GameObject.
      if (!beam.scene) return;
      beam.tilePositionY -= (WATER_BEAM_FLOW_SPEED * WATER_BEAM_FLOW_TICK_MS) / 1000;
    },
  });
  scene.time.delayedCall(BEAM_EXTEND_MS + 200, () => flowTimer.remove());
}
