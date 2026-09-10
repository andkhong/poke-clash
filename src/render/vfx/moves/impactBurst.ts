import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { buildImpactBurstTexture } from './pixelTextures';

/** One-shot sparkle burst at the moment of contact — shared by the beam
 * family's impact step and the lunge family's punch-landing flash (same
 * "shared asset across families" reuse as the move-animation families
 * themselves). Mirrors playSparkleReveal's explode-then-destroy pattern. */
export function playImpactBurst(scene: Phaser.Scene, x: number, y: number, type: PokemonTypeName): void {
  const color = getMoveTypeColor(type);
  const key = buildImpactBurstTexture(scene, color);

  const emitter = scene.add.particles(x, y, key, {
    speed: { min: 60, max: 160 },
    angle: { min: 0, max: 360 },
    scale: { start: 3.2, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: { min: 220, max: 360 },
    quantity: 10,
    blendMode: 'ADD',
    emitting: false,
  });
  emitter.setDepth(600);
  emitter.explode(10);

  scene.time.delayedCall(450, () => emitter.destroy());
}
