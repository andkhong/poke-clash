import { describe, expect, it } from 'vitest';
import { LOOP_FADE_S, loopFadeEnvelope } from './loopFade';

describe('loopFadeEnvelope', () => {
  const duration = 120;

  it('plays at full volume through the body of the track', () => {
    expect(loopFadeEnvelope(0, duration, false)).toBe(1);
    expect(loopFadeEnvelope(60, duration, false)).toBe(1);
    expect(loopFadeEnvelope(duration - LOOP_FADE_S, duration, true)).toBe(1);
  });

  it('ramps down linearly over the last LOOP_FADE_S seconds', () => {
    expect(loopFadeEnvelope(duration - LOOP_FADE_S / 2, duration, false)).toBeCloseTo(0.5, 6);
    expect(loopFadeEnvelope(duration, duration, false)).toBe(0);
  });

  it('does not fade in on the very first play, but does after the track has wrapped', () => {
    expect(loopFadeEnvelope(0, duration, false)).toBe(1);
    expect(loopFadeEnvelope(0, duration, true)).toBe(0);
    expect(loopFadeEnvelope(LOOP_FADE_S / 2, duration, true)).toBeCloseTo(0.5, 6);
    expect(loopFadeEnvelope(LOOP_FADE_S, duration, true)).toBe(1);
  });

  it('is full volume while the duration is still unknown', () => {
    expect(loopFadeEnvelope(1, NaN, true)).toBe(1);
    expect(loopFadeEnvelope(1, 0, true)).toBe(1);
    expect(loopFadeEnvelope(1, Infinity, true)).toBe(1);
  });

  it('never goes outside 0..1, even past the end or before the start', () => {
    expect(loopFadeEnvelope(duration + 5, duration, true)).toBe(0);
    expect(loopFadeEnvelope(-5, duration, true)).toBe(0);
  });
});
