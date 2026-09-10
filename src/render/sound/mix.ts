// Type-only — see loudness.ts for why this module avoids a Phaser runtime
// import (installMasterLimiter checks the sound manager structurally).
import type Phaser from 'phaser';

/**
 * The arena's mix, in one place. Every clip is loudness-normalized to its
 * category's target at play time (loudness.ts), so these three numbers *are*
 * the balance — retune here, not in the players.
 *
 * Calibrated against the reference battle footage in examples/ (three
 * clips, measured with ffmpeg's ebur128): those sit at -14 to -17 LUFS
 * integrated, with the music bed holding around -20 to -21 LUFS between
 * events and cries/attack hits peaking 7-10 dB above it, at roughly -10 to
 * -13 LUFS. Before this, our music played near -25 LUFS (a 0.35 flat gain
 * on tracks that vary 6+ dB among themselves), cries near -16 and move SFX
 * near -18 but each straddling a 10 dB range from clip to clip — quieter
 * overall than the reference and uneven within every category.
 *
 * Targets are LUFS as loudness.ts measures them (BS.1770, as heard through
 * a stereo output — the same thing ffmpeg reports for the reference clips,
 * once a mono file is counted as the dual-mono signal it plays back as).
 * Music sits at the reference's bed; move SFX 8 dB above it; cries a touch
 * lower than SFX, because the intro pops every Pokéball 130ms apart, so up
 * to a dozen cries overlap there and that pile-up adds up to far more than
 * any one of them.
 */
export const MUSIC_TARGET_DB = -21;
export const CRY_TARGET_DB = -15;
export const MOVE_SOUND_TARGET_DB = -13;

/** Flat per-category gains for the HTML5-audio fallback, where there are no
 * decoded samples to measure (see normalizedVolume in loudness.ts) — sized
 * for a typical clip in each pack and kept a little conservative, since the
 * master limiter below is WebAudio-only too. */
export const MUSIC_FALLBACK_VOLUME = 0.5;
export const CRY_FALLBACK_VOLUME = 0.45;
export const MOVE_SOUND_FALLBACK_VOLUME = 0.6;

/** Master limiter settings (a WebAudio DynamicsCompressorNode used as a
 * brick-wall-ish peak limiter). The normalized targets above are hot enough
 * that a cry landing on a music peak, or the intro's dozen overlapping
 * cries, would otherwise sum past full scale and hard-clip — the browser's
 * output simply truncates anything over 1.0, which is the harshest kind of
 * distortion. A high-ratio, fast, -6 dBFS threshold catches exactly those
 * sums and nothing else: music at its target peaks around -8 dBFS and never
 * touches it, a lone cry or SFX brushes it at most lightly. */
export const MASTER_LIMITER = {
  thresholdDb: -6,
  kneeDb: 4,
  ratio: 12,
  attackS: 0.002,
  releaseS: 0.12,
} as const;

/** The subset of Phaser.Sound.WebAudioSoundManager the limiter needs — the
 * HTML5 and no-audio managers have none of these, which is how they're told
 * apart without importing Phaser at runtime. */
interface WebAudioBus {
  context: AudioContext;
  masterVolumeNode: GainNode;
}

function isWebAudioBus(manager: unknown): manager is WebAudioBus {
  if (typeof manager !== 'object' || manager === null) return false;
  const m = manager as Partial<WebAudioBus>;
  return typeof AudioContext !== 'undefined' && m.context instanceof AudioContext && !!m.masterVolumeNode;
}

// Phaser wires masterMuteNode -> masterVolumeNode -> context.destination
// (WebAudioSoundManager.js); every sound plays into masterMuteNode. Splicing
// the limiter in after masterVolumeNode keeps Phaser's own mute/volume
// controls working exactly as before. One limiter per manager: PhaserGame.tsx
// builds a fresh Phaser.Game (and manager) per match, and a scene restart on
// the same game must not stack a second one.
const limitedManagers = new WeakSet<object>();

/** Puts a peak limiter on Phaser's master output for this scene's game.
 * No-op under the HTML5-audio/no-audio managers. Safe to call more than
 * once. */
export function installMasterLimiter(scene: Phaser.Scene): void {
  const manager: unknown = scene.sound;
  if (!isWebAudioBus(manager) || limitedManagers.has(manager)) return;

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
