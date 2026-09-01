import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import Phaser from 'phaser';
import { compositeGifFrames } from './gifCompositor';

export interface LoadedGifAnimation {
  textureKey: string;
  animationKey: string;
  frameCount: number;
  width: number;
  height: number;
}

// Phaser's own loader only ever grabs a GIF's first frame — animating one means
// decoding every frame ourselves and uploading each as a numbered sub-frame of
// one tall CanvasTexture, then registering a Phaser animation over it. The
// TextureManager lives on the Game instance (not the Scene), so once a species'
// sprite is decoded it stays cached across scene restarts / future matches.
const cache = new Map<string, Promise<LoadedGifAnimation | null>>();

export function loadGifAsAnimatedTexture(
  scene: Phaser.Scene,
  url: string,
  textureKey: string
): Promise<LoadedGifAnimation | null> {
  const cached = cache.get(textureKey);
  if (cached) return cached;

  const promise = decodeAndRegister(scene, url, textureKey);
  cache.set(textureKey, promise);
  // Don't cache a failed decode — a transient network blip shouldn't permanently
  // poison this texture key for the rest of the session.
  promise.then((result) => {
    if (!result) cache.delete(textureKey);
  });
  return promise;
}

async function decodeAndRegister(
  scene: Phaser.Scene,
  url: string,
  textureKey: string
): Promise<LoadedGifAnimation | null> {
  const textureManager = scene.sys.game.textures;
  const animationKey = textureKey;

  if (textureManager.exists(textureKey)) {
    const source = textureManager.get(textureKey).source[0];
    return {
      textureKey,
      animationKey,
      frameCount: textureManager.get(textureKey).frameTotal - 1, // frameTotal includes Phaser's implicit '__BASE' frame
      width: source.width,
      height: source.height / Math.max(1, textureManager.get(textureKey).frameTotal - 1),
    };
  }

  let buffer: ArrayBuffer;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    buffer = await res.arrayBuffer();
  } catch {
    return null;
  }

  let frames: ParsedFrame[];
  let width: number;
  let height: number;
  try {
    const gif = parseGIF(buffer);
    frames = decompressFrames(gif, true);
    width = gif.lsd.width;
    height = gif.lsd.height;
  } catch {
    return null;
  }
  if (frames.length === 0) return null;

  const composited = compositeGifFrames(frames, width, height);

  const canvasTexture = textureManager.createCanvas(textureKey, width, height * composited.length);
  if (!canvasTexture) return null;
  const ctx = canvasTexture.getContext();
  composited.forEach((buf, i) => {
    const imageData = new ImageData(new Uint8ClampedArray(buf), width, height);
    ctx.putImageData(imageData, 0, i * height);
    canvasTexture.add(i, 0, 0, i * height, width, height);
  });
  canvasTexture.refresh();

  if (!scene.anims.exists(animationKey)) {
    scene.anims.create({
      key: animationKey,
      frames: composited.map((_, i) => ({
        key: textureKey,
        frame: i,
        // gifuct-js reports delay already in ms; clamp against 0/undefined
        // encoder quirks that would otherwise animate too fast to read.
        duration: Math.max(20, frames[i].delay || 80),
      })),
      repeat: -1,
    });
  }

  return { textureKey, animationKey, frameCount: composited.length, width, height };
}
