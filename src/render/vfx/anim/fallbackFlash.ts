import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';

const RING_DURATION_MS = 260;
const RING_START_RADIUS = 6;
const RING_END_RADIUS = 26;

/** A quick type-colored ring at the point of impact. Two uses: an attack
 * whose animation hasn't finished downloading yet (it's queued for next
 * time — see moveAnimLoader.ts's requestMoveAnimation), and the handful of
 * pack animations that only move or tint the battlers and draw nothing
 * themselves (Psychic, Confusion, Struggle, ...), so a hit is never
 * invisible. Deliberately minimal: it's a stand-in, not a family. */
export function playFallbackFlash(scene: Phaser.Scene, x: number, y: number, type: PokemonTypeName): void {
  const color = getMoveTypeColor(type);
  const ring = scene.add.circle(x, y, RING_START_RADIUS).setStrokeStyle(3, color, 0.9).setDepth(y + 1);
  scene.tweens.add({
    targets: ring,
    radius: RING_END_RADIUS,
    alpha: 0,
    duration: RING_DURATION_MS,
    ease: 'Cubic.easeOut',
    onUpdate: () => ring.setRadius(ring.radius),
    onComplete: () => ring.destroy(),
  });
}
