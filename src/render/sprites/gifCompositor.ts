// Pure GIF-frame compositing math, deliberately free of any Canvas/DOM/Phaser
// API so it's unit-testable in Node. Spiked against real Showdown sprite GIFs
// (see gifTexture.ts) — Phaser's own texture loader only ever takes a GIF's
// first frame, so animating one means decoding frames ourselves (via
// gifuct-js) and compositing each into a full-canvas-sized RGBA buffer we can
// then upload as individual Phaser texture frames.

export interface DecodedFrameLike {
  dims: { top: number; left: number; width: number; height: number };
  /** RGBA bytes, length === dims.width * dims.height * 4 (gifuct-js's `patch`). */
  patch: Uint8ClampedArray | number[];
  /** GIF disposal method: 0/1 = leave as-is, 2 = restore to background (clear), 3 = restore to previous. */
  disposalType: number;
}

/**
 * Composites a decoded GIF's frames into one full-canvas RGBA buffer per
 * frame, honoring each frame's sub-region offset and disposal method.
 * Showdown's battle sprites are dominated by disposalType 2 (clear after
 * showing), which in practice means "each frame effectively replaces the
 * last" — but this still handles the general case (accumulating frames when
 * disposalType is 0/1) since nothing guarantees every GIF behaves that way.
 */
export function compositeGifFrames(
  frames: readonly DecodedFrameLike[],
  canvasWidth: number,
  canvasHeight: number
): Uint8ClampedArray[] {
  const composited: Uint8ClampedArray[] = [];
  let canvas = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
  let pendingClear = false;

  for (const frame of frames) {
    if (pendingClear) {
      canvas = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
      pendingClear = false;
    }

    const { left, top, width, height } = frame.dims;
    for (let y = 0; y < height; y++) {
      const destY = top + y;
      if (destY < 0 || destY >= canvasHeight) continue;
      for (let x = 0; x < width; x++) {
        const destX = left + x;
        if (destX < 0 || destX >= canvasWidth) continue;

        const srcIdx = (y * width + x) * 4;
        const alpha = frame.patch[srcIdx + 3];
        if (alpha === 0) continue; // transparent pixel: preserve whatever's already composited there

        const destIdx = (destY * canvasWidth + destX) * 4;
        canvas[destIdx] = frame.patch[srcIdx];
        canvas[destIdx + 1] = frame.patch[srcIdx + 1];
        canvas[destIdx + 2] = frame.patch[srcIdx + 2];
        canvas[destIdx + 3] = alpha;
      }
    }

    composited.push(canvas.slice()); // snapshot — later mutation of `canvas` must not affect this frame
    if (frame.disposalType === 2 || frame.disposalType === 3) pendingClear = true;
  }

  return composited;
}
