import { describe, expect, it } from 'vitest';
import { compositeGifFrames, type DecodedFrameLike } from './gifCompositor';

function solidPatch(width: number, height: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const patch = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    patch[i * 4] = r;
    patch[i * 4 + 1] = g;
    patch[i * 4 + 2] = b;
    patch[i * 4 + 3] = a;
  }
  return patch;
}

function pixelAt(buffer: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [buffer[idx], buffer[idx + 1], buffer[idx + 2], buffer[idx + 3]];
}

describe('compositeGifFrames', () => {
  it('places a full-size opaque frame directly (the common Showdown-sprite case)', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 0, top: 0, width: 2, height: 2 }, patch: solidPatch(2, 2, 255, 0, 0, 255), disposalType: 2 },
    ];
    const [result] = compositeGifFrames(frames, 2, 2);
    expect(pixelAt(result, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result, 2, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('clears the canvas between frames when disposalType is 2 (restore to background)', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 0, top: 0, width: 2, height: 2 }, patch: solidPatch(2, 2, 255, 0, 0, 255), disposalType: 2 },
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 0, 255, 0, 255), disposalType: 2 },
    ];
    const [, frame2] = compositeGifFrames(frames, 2, 2);
    // frame 2 only draws a 1x1 green patch at (0,0) — everywhere else must be
    // cleared to transparent because frame 1's disposalType was 2, not carried over.
    expect(pixelAt(frame2, 2, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(frame2, 2, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('accumulates onto the previous frame when disposalType is 0/1 (do not dispose)', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 0, top: 0, width: 2, height: 2 }, patch: solidPatch(2, 2, 255, 0, 0, 255), disposalType: 1 },
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 0, 255, 0, 255), disposalType: 1 },
    ];
    const [, frame2] = compositeGifFrames(frames, 2, 2);
    // frame 1's red should still show through at (1,1) since nothing disposed it.
    expect(pixelAt(frame2, 2, 0, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(frame2, 2, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it('respects a sub-region offset (left/top) rather than always drawing at the origin', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 1, top: 1, width: 1, height: 1 }, patch: solidPatch(1, 1, 10, 20, 30, 255), disposalType: 2 },
    ];
    const [result] = compositeGifFrames(frames, 3, 3);
    expect(pixelAt(result, 3, 1, 1)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(result, 3, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('never overwrites existing pixels with a fully-transparent source pixel', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 200, 0, 0, 255), disposalType: 1 },
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 0, 0, 0, 0), disposalType: 1 },
    ];
    const [, frame2] = compositeGifFrames(frames, 1, 1);
    expect(pixelAt(frame2, 1, 0, 0)).toEqual([200, 0, 0, 255]); // untouched by the transparent overlay
  });

  it('returns one buffer per input frame, each independently snapshotted', () => {
    const frames: DecodedFrameLike[] = [
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 1, 1, 1, 255), disposalType: 2 },
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 2, 2, 2, 255), disposalType: 2 },
      { dims: { left: 0, top: 0, width: 1, height: 1 }, patch: solidPatch(1, 1, 3, 3, 3, 255), disposalType: 2 },
    ];
    const results = compositeGifFrames(frames, 1, 1);
    expect(results.length).toBe(3);
    expect(results[0][0]).toBe(1);
    expect(results[1][0]).toBe(2);
    expect(results[2][0]).toBe(3);
  });
});
