import sharp, { type PngOptions } from 'sharp';

// Shared by optimize-pmd-sprites.ts (PMD sprite sheets) and
// build-move-animations.ts (move animation sheets): re-encode a PNG as an
// indexed/palette PNG, which is ~45% of the size for pixel art that uses a
// few dozen colors. Quantization is nominally lossy, so the output is
// decoded and compared with the source on every visible pixel; anything
// that doesn't come back exact (a sheet with more than 256 colors, say) is
// written losslessly at max deflate effort instead, and the caller is told
// so it can count the fallbacks. Fully transparent pixels are allowed to
// lose their (invisible) RGB — the only thing quantization changes on these
// sheets.

const PALETTE_PNG: PngOptions = { palette: true, quality: 100, effort: 10, dither: 0, compressionLevel: 9 };
const LOSSLESS_PNG: PngOptions = { palette: false, effort: 10, compressionLevel: 9 };

/** True when every pixel with any opacity matches exactly (RGBA); the RGB
 * of fully transparent pixels is ignored. */
export function visiblePixelsIdentical(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) return false;
  }
  return true;
}

/** `source` is a file path or an already-decoded PNG buffer. */
export async function optimizePng(source: string | Buffer): Promise<{ png: Buffer; lossless: boolean }> {
  const original = await sharp(source).ensureAlpha().raw().toBuffer();
  const palette = await sharp(source).png(PALETTE_PNG).toBuffer();
  const roundTrip = await sharp(palette).ensureAlpha().raw().toBuffer();
  if (visiblePixelsIdentical(original, roundTrip)) return { png: palette, lossless: false };
  return { png: await sharp(source).png(LOSSLESS_PNG).toBuffer(), lossless: true };
}
