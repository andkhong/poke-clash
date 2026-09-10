import { describe, expect, it } from 'vitest';
import {
  LOUDNESS_ABSOLUTE_GATE_LUFS,
  MAX_NORMALIZATION_BOOST_DB,
  measureLoudnessDb,
  normalizationGain,
  type PcmClip,
} from './loudness';

const SAMPLE_RATE = 44_100;

function clipFrom(channels: Float32Array[], sampleRate = SAMPLE_RATE): PcmClip {
  return {
    sampleRate,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (c) => channels[c],
  };
}

function sine(amplitude: number, seconds: number, hz = 1000, sampleRate = SAMPLE_RATE): Float32Array {
  const data = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return data;
}

function scaled(data: Float32Array, gain: number): Float32Array {
  return data.map((v) => v * gain);
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('measureLoudnessDb (BS.1770 integrated loudness, as heard in stereo)', () => {
  it('reads a full-scale 1 kHz sine in both stereo channels close to the standard\'s -0.7 LUFS', () => {
    // BS.1770 puts a full-scale 1 kHz sine in ONE channel at -3.01 LUFS;
    // in both channels the summed power makes it -0.69 (the K-weighting
    // shelf lifts 1 kHz by only a few tenths of a dB).
    const measured = measureLoudnessDb(clipFrom([sine(1, 1), sine(1, 1)]))!;
    expect(measured).toBeGreaterThan(-1.5);
    expect(measured).toBeLessThan(0.5);
  });

  it('reads a mono clip as the dual-mono signal WebAudio up-mixes it to — the same as that signal in stereo', () => {
    const mono = measureLoudnessDb(clipFrom([sine(0.5, 1)]))!;
    const dualMono = measureLoudnessDb(clipFrom([sine(0.5, 1), sine(0.5, 1)]))!;
    expect(mono).toBeCloseTo(dualMono, 3);
  });

  it('scales with level: half the amplitude reads 6.02 dB lower', () => {
    const full = measureLoudnessDb(clipFrom([sine(1, 1)]))!;
    const half = measureLoudnessDb(clipFrom([sine(0.5, 1)]))!;
    expect(full - half).toBeCloseTo(20 * Math.log10(2), 1);
  });

  it('is K-weighted: a bright 6 kHz tone reads ~4 dB louder than a 300 Hz tone of the same amplitude', () => {
    const bright = measureLoudnessDb(clipFrom([sine(0.5, 1, 6000)]))!;
    const dull = measureLoudnessDb(clipFrom([sine(0.5, 1, 300)]))!;
    expect(bright - dull).toBeGreaterThan(3);
    expect(bright - dull).toBeLessThan(5);
  });

  it('gives the same answer at 48 kHz as at 44.1 kHz (the K-weighting is derived per sample rate)', () => {
    const at44 = measureLoudnessDb(clipFrom([sine(0.5, 1, 3000, 44_100)], 44_100))!;
    const at48 = measureLoudnessDb(clipFrom([sine(0.5, 1, 3000, 48_000)], 48_000))!;
    expect(at44).toBeCloseTo(at48, 1);
  });

  // Both gate tests use a 3s tone: the 400 ms blocks that straddle the edge
  // where the tone stops hold only part of it and read a few dB down — an
  // edge effect BS.1770 (and ffmpeg's ebur128) genuinely has, worth ~0.2 dB
  // on a 3s tone but ~1.5 dB on a half-second one.
  it('is not dragged down by a long silent tail (absolute gate), as a cry with trailing silence would be', () => {
    const tone = sine(0.5, 3);
    const alone = measureLoudnessDb(clipFrom([tone]))!;
    const withTail = concat(tone, new Float32Array(SAMPLE_RATE * 4)); // 4s of digital silence after
    expect(measureLoudnessDb(clipFrom([withTail]))).toBeCloseTo(alone, 0);
  });

  it('is not dragged down by a long very quiet passage either (relative gate)', () => {
    const loud = sine(0.5, 3);
    const alone = measureLoudnessDb(clipFrom([loud]))!;
    const faint = sine(0.005, 4); // ~-49 dBFS: above the absolute gate, far below the loud part
    // Ungated, 4s of faint audio would pull the mean power down by ~4 dB.
    expect(measureLoudnessDb(clipFrom([concat(loud, faint)]))).toBeCloseTo(alone, 0);
  });

  it('reports null for a silent clip, one entirely under the absolute gate, and one with no channels', () => {
    expect(measureLoudnessDb(clipFrom([new Float32Array(SAMPLE_RATE)]))).toBeNull();
    const underGate = sine(Math.pow(10, (LOUDNESS_ABSOLUTE_GATE_LUFS - 6) / 20), 1);
    expect(measureLoudnessDb(clipFrom([underGate]))).toBeNull();
    expect(measureLoudnessDb(clipFrom([]))).toBeNull();
  });

  it('measures a clip shorter than one 400 ms block as a single block instead of giving up', () => {
    const short = measureLoudnessDb(clipFrom([sine(0.5, 0.05)]))!;
    const long = measureLoudnessDb(clipFrom([sine(0.5, 1)]))!;
    expect(short).toBeCloseTo(long, 0);
  });

  it('never mutates the clip\'s own sample data', () => {
    const data = sine(0.5, 0.5);
    const copy = Float32Array.from(data);
    measureLoudnessDb(clipFrom([data]));
    expect(data).toEqual(copy);
  });
});

describe('normalizationGain', () => {
  it('brings clips of different levels to the same target', () => {
    const target = -20;
    const hot = sine(1, 1);
    const quiet = sine(0.25, 1);
    const hotGain = normalizationGain(clipFrom([hot]), target);
    const quietGain = normalizationGain(clipFrom([quiet]), target);
    expect(measureLoudnessDb(clipFrom([scaled(hot, hotGain)]))).toBeCloseTo(target, 1);
    expect(measureLoudnessDb(clipFrom([scaled(quiet, quietGain)]))).toBeCloseTo(target, 1);
    expect(hotGain).toBeLessThan(quietGain);
  });

  it('never boosts more than MAX_NORMALIZATION_BOOST_DB, even for a very quiet clip', () => {
    const veryQuiet = clipFrom([sine(0.01, 1)]); // ≈ -40 LUFS
    const gain = normalizationGain(veryQuiet, -10);
    expect(20 * Math.log10(gain)).toBeCloseTo(MAX_NORMALIZATION_BOOST_DB, 5);
  });

  it('leaves a silent clip at unity gain', () => {
    expect(normalizationGain(clipFrom([new Float32Array(SAMPLE_RATE)]), -10)).toBe(1);
  });
});
