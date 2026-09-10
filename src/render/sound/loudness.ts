// Type-only: this module stays free of any Phaser runtime dependency so its
// measurement can be unit-tested (and run offline against the asset packs,
// see the calibration notes in mix.ts) without a browser.
import type Phaser from 'phaser';

/**
 * Play-time loudness normalization for every clip the arena plays — battle
 * music, Pokémon cries, move SFX — so each lands at its category's target
 * level (see mix.ts) regardless of how hot its source file happens to be.
 *
 * A single per-category gain can't make the mix even, because the source
 * files themselves aren't: measured with ffmpeg's ebur128 across the
 * mirrored packs, cries span roughly -7 to -17 LUFS, move SFX -8 to -19, and
 * soundtrack tracks -11 to -28. That 10-17 dB spread inside each category
 * is exactly the "one attack is deafening, the next is inaudible"
 * unevenness, and it's the source files' doing, not the gains'. Measuring
 * each decoded clip once and choosing its gain to hit the target flattens
 * it.
 *
 * The measure is integrated loudness per ITU-R BS.1770 (what "LUFS" means):
 * K-weighting (a high shelf lifting everything above ~1.5 kHz by 4 dB, then
 * a ~38 Hz high-pass) so a bright noise-burst SFX and a dull thud that
 * *sound* equally loud also *measure* equally loud, 400 ms blocks at a
 * 100 ms hop, channel powers summed, then the standard two-stage gate (drop
 * blocks under -70 LUFS, then blocks more than 10 LU under the mean) so a
 * clip's silent tail can't drag its level down. Two refinements for how
 * clips are actually heard here: a clip shorter than one 400 ms block (many
 * cries and hits) is measured as a single block rather than not at all, and
 * a mono clip is measured as the dual-mono stereo signal WebAudio up-mixes
 * it to (twice the power, +3 dB), so mono SFX and stereo music are compared
 * as they come out of the speakers. Checked against ffmpeg's ebur128 on the
 * same files (see mix.ts), it tracks within about 1 dB.
 */

/** The slice of AudioBuffer this needs — a plain object with these fields
 * works too, which keeps measureLoudnessDb testable without a real
 * WebAudio context. */
export interface PcmClip {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/** BS.1770 block geometry: 400 ms blocks every 100 ms. */
export const LOUDNESS_BLOCK_S = 0.4;
export const LOUDNESS_HOP_S = 0.1;
export const LOUDNESS_ABSOLUTE_GATE_LUFS = -70;
export const LOUDNESS_RELATIVE_GATE_LU = -10;
/** The BS.1770 calibration constant: a full-scale 1 kHz sine in one
 * channel of a stereo pair reads -3.01 LUFS. */
const LOUDNESS_OFFSET_DB = -0.691;
/** A quiet source file is boosted at most this much toward its target —
 * past this the pick-up in hiss/quantization noise isn't worth the last
 * few dB, and a badly mis-mastered clip staying a little quiet is the
 * lesser evil. */
export const MAX_NORMALIZATION_BOOST_DB = 12;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages, derived for any sample rate (the standard
 * tabulates them for 48 kHz only; these reproduce that table exactly at
 * 48 kHz and hold their shape at 44.1 kHz and others). */
function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: +4 dB high shelf.
  const shelfGainDb = 4.0;
  const shelfQ = 1 / Math.SQRT2;
  const shelfFc = 1681.974450955533;
  let k = Math.tan((Math.PI * shelfFc) / sampleRate);
  const vh = Math.pow(10, shelfGainDb / 20);
  const vb = Math.pow(vh, 0.499666774155);
  let a0 = 1 + k / shelfQ + k * k;
  const shelf: Biquad = {
    b0: (vh + (vb * k) / shelfQ + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / shelfQ + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / shelfQ + k * k) / a0,
  };
  // Stage 2: high-pass.
  const hpQ = 0.5003270373238773;
  const hpFc = 38.13547087602444;
  k = Math.tan((Math.PI * hpFc) / sampleRate);
  a0 = 1 + k / hpQ + k * k;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / hpQ + k * k) / a0,
  };
  return [shelf, highPass];
}

function lufs(power: number): number {
  return LOUDNESS_OFFSET_DB + 10 * Math.log10(power);
}

/** Integrated loudness of a decoded clip in LUFS as heard through a stereo
 * output (see the module comment), or null for a clip that's silent
 * throughout. Never mutates the clip's sample data. */
export function measureLoudnessDb(clip: PcmClip): number | null {
  const n = clip.length;
  const channels = clip.numberOfChannels;
  if (n === 0 || channels === 0) return null;

  // K-weighted power per 100 ms sub-block, summed across channels, plus
  // each sub-block's sample count (only the last can be short).
  const hop = Math.max(1, Math.round(clip.sampleRate * LOUDNESS_HOP_S));
  const subBlocks = Math.ceil(n / hop);
  const subPower = new Float64Array(subBlocks);
  const subCount = new Float64Array(subBlocks);
  for (let j = 0; j < subBlocks; j++) subCount[j] = Math.min(hop, n - j * hop);

  const [shelf, highPass] = kWeighting(clip.sampleRate);
  for (let c = 0; c < channels; c++) {
    const x = clip.getChannelData(c);
    // Direct form I state for each stage.
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    let u1 = 0, u2 = 0, v1 = 0, v2 = 0;
    for (let i = 0; i < n; i++) {
      const s = x[i];
      const y = shelf.b0 * s + shelf.b1 * x1 + shelf.b2 * x2 - shelf.a1 * y1 - shelf.a2 * y2;
      x2 = x1; x1 = s; y2 = y1; y1 = y;
      const v = highPass.b0 * y + highPass.b1 * u1 + highPass.b2 * u2 - highPass.a1 * v1 - highPass.a2 * v2;
      u2 = u1; u1 = y; v2 = v1; v1 = v;
      subPower[(i / hop) | 0] += v * v;
    }
  }
  // BS.1770 sums channel powers; a mono clip is heard dual-mono through a
  // stereo output, i.e. at twice the power.
  const channelScale = channels === 1 ? 2 : 1;

  // 400 ms blocks (4 sub-blocks); a clip shorter than that is one block.
  const perBlock = Math.round(LOUDNESS_BLOCK_S / LOUDNESS_HOP_S);
  const blockPowers: number[] = [];
  const lastStart = Math.max(0, subBlocks - perBlock);
  for (let start = 0; start <= lastStart; start++) {
    let power = 0;
    let count = 0;
    for (let j = start; j < Math.min(subBlocks, start + perBlock); j++) {
      power += subPower[j];
      count += subCount[j];
    }
    if (count > 0) blockPowers.push((channelScale * power) / count);
  }

  const absoluteGate = Math.pow(10, (LOUDNESS_ABSOLUTE_GATE_LUFS - LOUDNESS_OFFSET_DB) / 10);
  const aboveAbsolute = blockPowers.filter((p) => p > absoluteGate);
  if (aboveAbsolute.length === 0) return null;
  const meanAbove = aboveAbsolute.reduce((s, p) => s + p, 0) / aboveAbsolute.length;
  const relativeGate = meanAbove * Math.pow(10, LOUDNESS_RELATIVE_GATE_LU / 10);
  const kept = aboveAbsolute.filter((p) => p > relativeGate);
  const pool = kept.length > 0 ? kept : aboveAbsolute;
  return lufs(pool.reduce((s, p) => s + p, 0) / pool.length);
}

/** Linear gain that plays `clip` at `targetDb` — 1 for a silent clip
 * (nothing to normalize), never more than MAX_NORMALIZATION_BOOST_DB up. */
export function normalizationGain(clip: PcmClip, targetDb: number): number {
  const measured = measureLoudnessDb(clip);
  if (measured === null) return 1;
  return gainFromMeasured(measured, targetDb);
}

function gainFromMeasured(measuredDb: number, targetDb: number): number {
  return Math.pow(10, Math.min(MAX_NORMALIZATION_BOOST_DB, targetDb - measuredDb) / 20);
}

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
  return gainFromMeasured(measured, targetDb);
}
