import Phaser from 'phaser';
import type { PokemonTypeName } from '../../../sim/types';
import { getMoveTypeColor } from '../typeColor';
import { lighten } from './pixelTextures';
import { playImpactBurst } from './impactBurst';

/** Surf-style VFX (see moveAnimations.ts's override) — a curling wave that
 * sweeps in from the attacker's general direction and crashes over the
 * target, rather than a projectile flying from the attacker to the target
 * like every other ranged family. This is the "field effect appearing at the
 * target" case flagged (and deliberately deferred) when Surf/Hurricane were
 * first pinned to the plain 'impact' fallback — see that override's own
 * comment; this fills it in for water specifically.
 *
 * Drawn as a Graphics band redrawn every tween tick (same technique as
 * beamAttack.ts's outer/inner stroke), made of several overlapping circular
 * humps that taper toward both ends so it reads as one curved crest rather
 * than a straight line, with a paler foam cap riding just ahead of each hump.
 * The whole band sweeps along the attacker→target line — starting short of
 * the target (still approaching), rising to full height as it reaches the
 * target, then continuing a little past it before flattening back out — so
 * it plays as "washes in, crests right on the target, recedes" instead of
 * static. The attacker itself is never moved; only its direction to the
 * target matters, for which way the wave travels.
 */
const RISE_DURATION_MS = 260;
const CREST_HOLD_MS = 90;
const RECEDE_DURATION_MS = 220;
const WAVE_WIDTH_PX = 170;
const WAVE_HUMPS = 7;
/** How far short of the target the wave starts (still approaching) and how
 * far past it the wave continues before receding, in px along the direction
 * of travel. */
const APPROACH_OFFSET_PX = 120;
const OVERSHOOT_OFFSET_PX = 40;

export function playWaveAttack(
  scene: Phaser.Scene,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  type: PokemonTypeName
): void {
  const color = getMoveTypeColor(type);
  const foamColor = lighten(color, 0.75);

  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const perpX = -dirY;
  const perpY = dirX;

  const body = scene.add.graphics().setDepth(499);
  const foamCap = scene.add.graphics().setDepth(500);

  // Per-hump jitter, seeded once and reused on every redraw, so the crest's
  // silhouette stays one stable, organic shape as it sweeps rather than
  // reshuffling every frame.
  const humpJitter = Array.from({ length: WAVE_HUMPS }, () => 0.75 + Math.random() * 0.5);

  const drawWave = (sweepT: number, curl: number): void => {
    const centerX = Phaser.Math.Linear(toX - dirX * APPROACH_OFFSET_PX, toX + dirX * OVERSHOOT_OFFSET_PX, sweepT);
    const centerY = Phaser.Math.Linear(toY - dirY * APPROACH_OFFSET_PX, toY + dirY * OVERSHOOT_OFFSET_PX, sweepT);

    body.clear();
    foamCap.clear();
    for (let i = 0; i < WAVE_HUMPS; i++) {
      const t = i / (WAVE_HUMPS - 1); // 0..1 across the wave's width
      const taper = Math.sin(t * Math.PI); // 0 at both ends, 1 in the middle
      const humpRadius = (14 + taper * humpJitter[i] * 22) * curl;
      if (humpRadius <= 1) continue;
      const offset = (t - 0.5) * WAVE_WIDTH_PX;
      const hx = centerX + perpX * offset;
      const hy = centerY + perpY * offset;
      body.fillStyle(color, 0.75);
      body.fillCircle(hx, hy, humpRadius);
      foamCap.fillStyle(foamColor, 0.9);
      foamCap.fillCircle(hx + dirX * humpRadius * 0.3, hy + dirY * humpRadius * 0.3, humpRadius * 0.4);
    }
  };

  drawWave(0, 0);

  const progress = { sweep: 0, curl: 0 };
  scene.tweens.chain({
    targets: progress,
    tweens: [
      {
        sweep: 0.55,
        curl: 1,
        duration: RISE_DURATION_MS,
        ease: 'Sine.easeIn',
        onUpdate: () => drawWave(progress.sweep, progress.curl),
      },
      { curl: 1, duration: CREST_HOLD_MS, onUpdate: () => drawWave(progress.sweep, progress.curl) },
      {
        sweep: 1,
        curl: 0,
        duration: RECEDE_DURATION_MS,
        ease: 'Sine.easeOut',
        onUpdate: () => drawWave(progress.sweep, progress.curl),
      },
    ],
    onComplete: () => {
      body.destroy();
      foamCap.destroy();
    },
  });

  scene.time.delayedCall(RISE_DURATION_MS, () => {
    if (!scene.sys.isActive()) return; // scene torn down mid-delay (e.g. match restarted)
    playImpactBurst(scene, toX, toY, type);
  });
}
