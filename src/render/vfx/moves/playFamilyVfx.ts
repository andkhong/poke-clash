import Phaser from 'phaser';
import type { PokemonTypeName, Vec2 } from '../../../sim/types';
import type { MoveAnimationFamily } from '../moveAnimations';
import { playMoveImpact } from '../moveEffects';
import { playBeamAttack, preloadBeamVfxAssets } from './beamAttack';
import { playFlameAttack, preloadFlameVfxAssets } from './flameAttack';
import { playThunderAttack, preloadThunderVfxAssets } from './thunderAttack';
import { playLeafAttack, preloadLeafVfxAssets } from './leafAttack';
import { playBubbleAttack, preloadBubbleVfxAssets } from './bubbleAttack';
import { playWaveAttack } from './waveAttack';
import { playIceShardAttack, preloadIceShardVfxAssets } from './iceShardAttack';
import { playVortexAttack, preloadVortexVfxAssets } from './vortexAttack';
import { playRockBurstAttack, preloadRockBurstVfxAssets } from './rockBurstAttack';
import { playPoisonAttack, preloadPoisonVfxAssets } from './poisonAttack';
import { playHydroPumpAttack, preloadHydroPumpVfxAssets } from './hydroPumpAttack';
import { playImpactBurst } from './impactBurst';
import { playLungePunchFlash, preloadLungeVfxAssets } from './lungeImpact';

// The arena's own family VFX (one hand-tuned effect per family, see
// moveAnimations.ts), kept for the moves whose Gen 9 Move Animation
// Project animation is a screen-wide effect — most of its cells anchored to
// the whole battle screen, or nothing but a full-screen overlay (see
// MoveAnimationIndexEntry.screen). A wave or a quake drawn across a
// side-view battle screen doesn't translate to a free-roaming top-down
// arena, so those moves get the wave/quake/etc. built for the arena
// instead; everything else plays the pack's animation (src/render/vfx/anim/).

/** Families drawn at the fighters' feet — a dash that moves the sprite
 * itself, or a ground/field effect erupting under the target — rather than
 * between their body centers like a beam, jet or bolt (see
 * PokemonSprite.getAnimAnchor; review note on Bleakwind Storm: "attack
 * sprite should be a little higher up"). */
const GROUND_FAMILIES: ReadonlySet<MoveAnimationFamily> = new Set<MoveAnimationFamily>(['lunge', 'wave', 'vortex', 'rockBurst']);

export function familyAnchorsAtBodyCenter(family: MoveAnimationFamily): boolean {
  return !GROUND_FAMILIES.has(family);
}

export function preloadFamilyVfxAssets(scene: Phaser.Scene): void {
  preloadPoisonVfxAssets(scene);
  preloadHydroPumpVfxAssets(scene);
  preloadThunderVfxAssets(scene);
  preloadIceShardVfxAssets(scene);
  preloadBubbleVfxAssets(scene);
  preloadLeafVfxAssets(scene);
  preloadRockBurstVfxAssets(scene);
  preloadVortexVfxAssets(scene);
  preloadBeamVfxAssets(scene);
  preloadFlameVfxAssets(scene);
  preloadLungeVfxAssets(scene);
}

/** What the lunge family needs from the attacker's sprite: the
 * dash-and-return motion (see PokemonSprite.playLungeAttack). */
export interface FamilyVfxAttacker {
  playLungeAttack(selfPosition: Vec2, targetPosition: Vec2, targetCollisionRadius: number, onImpact?: () => void): void;
}

/** Plays one family's effect from the attacker toward the single target.
 * Every family but lunge is fire-and-forget from `from` to `to`; lunge
 * dashes the attacker's sprite and lands its impact at the apex — at
 * `contact` (the target's body center) while `to` stays the feet the dash
 * steers by (review note on Steel Wing: "animation seems lower than the
 * target sprite"). */
export function playFamilyVfx(
  scene: Phaser.Scene,
  family: MoveAnimationFamily,
  from: Vec2,
  to: Vec2,
  targetCollisionRadius: number,
  type: PokemonTypeName,
  attacker: FamilyVfxAttacker,
  contact: Vec2 = to
): void {
  const { x: fromX, y: fromY } = from;
  const { x: toX, y: toY } = to;
  switch (family) {
    case 'lunge':
      attacker.playLungeAttack(from, to, targetCollisionRadius, () => {
        playImpactBurst(scene, contact.x, contact.y, type);
        playLungePunchFlash(scene, contact.x, contact.y);
      });
      break;
    case 'beam':
      playBeamAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'flame':
      playFlameAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'thunder':
      playThunderAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'leaf':
      playLeafAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'bubble':
      playBubbleAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'wave':
      playWaveAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'iceShard':
      playIceShardAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'vortex':
      playVortexAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'rockBurst':
      playRockBurstAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'poison':
      playPoisonAttack(scene, fromX, fromY, toX, toY, type);
      break;
    case 'hydroPump':
      playHydroPumpAttack(scene, fromX, fromY, toX, toY, type);
      break;
    default:
      playMoveImpact(scene, fromX, fromY, toX, toY, type);
  }
}
