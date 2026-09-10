import type Phaser from 'phaser';
import { gainToTarget, measureLoudnessDb } from './loudness';

// The browser-side half of loudness.ts: looks a decoded clip up in Phaser's
// audio cache, measures it once, and turns the result into the volume to
// play it at. Kept apart from the meter itself so the meter stays free of
// DOM types and importable from the node-side data pipeline.

// One measurement per decoded buffer per game — the buffer object itself is
// what Phaser's audio cache hands back, so keying on it means a re-created
// Phaser.Game (one per match, see PhaserGame.tsx) naturally starts fresh.
const measuredDbByBuffer = new WeakMap<object, number | null>();

function isAudioBuffer(value: unknown): value is AudioBuffer {
  return typeof AudioBuffer !== 'undefined' && value instanceof AudioBuffer;
}

/** The volume to hand Phaser so the cached clip `key` plays at `targetDb`.
 * Under WebAudio the cache holds the decoded AudioBuffer, which is measured
 * (once) and normalized; under the HTML5 audio fallback there are no
 * samples to look at, so `fallbackVolume` — a flat per-category gain sized
 * for a typical clip — is used instead. */
export function normalizedVolume(scene: Phaser.Scene, key: string, targetDb: number, fallbackVolume: number): number {
  const cached: unknown = scene.cache.audio.get(key);
  if (!isAudioBuffer(cached)) return fallbackVolume;
  let measured = measuredDbByBuffer.get(cached);
  if (measured === undefined) {
    measured = measureLoudnessDb(cached);
    measuredDbByBuffer.set(cached, measured);
  }
  if (measured === null) return 1;
  return gainToTarget(measured, targetDb);
}
