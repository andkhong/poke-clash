import Phaser from 'phaser';
import type { PokemonTypeName } from '../../sim/types';
import { getMoveTypeColor } from './typeColor';

/** A simple colored beam + impact-ring burst toward the target — not meant to be
 * move-specific VFX, just a legible "something hit something" cue matching the
 * lightweight particle/beam effects seen in the example videos. */
export function playMoveImpact(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);

  const beam = scene.add.line(0, 0, fromX, fromY, toX, toY, color, 0.7).setLineWidth(2).setDepth(500);
  scene.tweens.add({
    targets: beam,
    alpha: 0,
    duration: 220,
    onComplete: () => beam.destroy(),
  });

  const ring = scene.add.circle(toX, toY, 4, color, 0.6).setDepth(501);
  scene.tweens.add({
    targets: ring,
    radius: 22,
    alpha: 0,
    duration: 260,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}
