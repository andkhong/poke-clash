// Type-only: the sound manager is checked structurally below, so this
// module needs no Phaser at runtime.
import type Phaser from 'phaser';
import { MASTER_LIMITER } from './mix';

/** The subset of Phaser.Sound.WebAudioSoundManager the limiter (and
 * battleMusic.ts's streaming player) need — the HTML5 and no-audio managers
 * have none of these, which is how they're told apart without importing
 * Phaser at runtime. `destination` is what every Phaser sound connects to
 * (the mute node, upstream of the master volume and the limiter). */
export interface WebAudioBus {
  context: AudioContext;
  destination: AudioNode;
  masterVolumeNode: GainNode;
}

export function getWebAudioBus(manager: unknown): WebAudioBus | null {
  if (typeof manager !== 'object' || manager === null) return null;
  const m = manager as Partial<WebAudioBus>;
  if (typeof AudioContext === 'undefined' || !(m.context instanceof AudioContext)) return null;
  if (!m.masterVolumeNode || !m.destination) return null;
  return m as WebAudioBus;
}

// Phaser wires masterMuteNode -> masterVolumeNode -> context.destination
// (WebAudioSoundManager.js); every sound plays into masterMuteNode. Splicing
// the limiter in after masterVolumeNode keeps Phaser's own mute/volume
// controls working exactly as before. One limiter per manager: PhaserGame.tsx
// builds a fresh Phaser.Game (and manager) per match, and a scene restart on
// the same game must not stack a second one.
const limitedManagers = new WeakSet<object>();

/** Puts a peak limiter (see MASTER_LIMITER in mix.ts) on Phaser's master
 * output for this scene's game. No-op under the HTML5-audio/no-audio
 * managers. Safe to call more than once. */
export function installMasterLimiter(scene: Phaser.Scene): void {
  const manager = getWebAudioBus(scene.sound);
  if (!manager || limitedManagers.has(manager)) return;

  const limiter = manager.context.createDynamicsCompressor();
  limiter.threshold.value = MASTER_LIMITER.thresholdDb;
  limiter.knee.value = MASTER_LIMITER.kneeDb;
  limiter.ratio.value = MASTER_LIMITER.ratio;
  limiter.attack.value = MASTER_LIMITER.attackS;
  limiter.release.value = MASTER_LIMITER.releaseS;

  manager.masterVolumeNode.disconnect();
  manager.masterVolumeNode.connect(limiter);
  limiter.connect(manager.context.destination);
  limitedManagers.add(manager);
}
