import { useEffect, useRef, useState, type CSSProperties } from 'react';
import idleSprites from '../../data/generated/idleSprites.json';
import { pmdSheetUrl } from '../../render/sprites/pmdSheetUrl';
import { FACE_DOWN } from '../landing/courtSprites';
import { FONT_UI, INK_MUTED } from '../theme';

/** [sheet dir, version, frame width, frame height, frame count, loop ms] for Gens 1–4 — see data-pipeline/pmdSpriteIndexFiles.ts. */
type IdleEntry = [string, string, number, number, number, number];
const IDLE = idleSprites as unknown as Record<string, IdleEntry>;

// One shared keyframe: each sprite sets how far its sheet slides via --ss-shift.
const IDLE_KEYFRAMES =
  '@keyframes ss-idle{to{transform:translateX(var(--ss-shift))}}@media (prefers-reduced-motion:reduce){.ss-anim{animation:none!important}}';
const MAX_SCALE = 4;

/** Each species' front-facing first Idle frame, trimmed to its visible pixels — loaded and measured once, shared by every tile. */
const trimmed = new Map<number, Promise<HTMLCanvasElement | null>>();
function trimmedFrame(speciesId: number, [dir, version, w, h]: IdleEntry): Promise<HTMLCanvasElement | null> {
  let frame = trimmed.get(speciesId);
  if (!frame) {
    frame = new Promise((resolve) => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          resolve(trim(img, w, h));
        } catch {
          resolve(null); // e.g. a cross-origin sheet the canvas can't read
        }
      };
      img.src = pmdSheetUrl(dir, 'Idle', version);
    });
    trimmed.set(speciesId, frame);
  }
  return frame;
}

function trim(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement | null {
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, FACE_DOWN * h, w, h, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;
  let [left, top, right, bottom] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (pixels[(y * w + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) return null;
  const out = document.createElement('canvas');
  out.width = right - left + 1;
  out.height = bottom - top + 1;
  out.getContext('2d')?.drawImage(full, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

interface SpeciesSpriteProps {
  speciesId: number;
  /** Square box in CSS px; the sprite is scaled to fit inside it. */
  size: number;
  /** Loop the Idle animation instead of holding its first frame. */
  animate?: boolean;
  /** Its first letter stands in if the sheet is missing or fails to load. */
  name?: string;
}

/** A species' front-facing PMD Idle sprite, from the same sheet the arena loads, scaled up pixel-crisp to fit its box. Decorative: callers label it. */
export function SpeciesSprite({ speciesId, size, animate = false, name }: SpeciesSpriteProps) {
  const entry = IDLE[speciesId];
  const [failed, setFailed] = useState(false);
  const box: CSSProperties = { width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden' };
  if (!entry || failed) {
    return (
      <span aria-hidden style={{ ...box, fontFamily: FONT_UI, fontWeight: 700, fontSize: size / 2, color: INK_MUTED }}>
        {name?.[0] ?? '?'}
      </span>
    );
  }
  return animate ? (
    <AnimatedSprite entry={entry} size={size} box={box} onFail={setFailed} />
  ) : (
    <StillSprite speciesId={speciesId} entry={entry} size={size} box={box} onFail={setFailed} />
  );
}

interface SpriteProps {
  entry: IdleEntry;
  size: number;
  box: CSSProperties;
  onFail: (failed: true) => void;
}

/** First frame trimmed to its pixels and fitted to the box; the sheet loads once the tile scrolls near view. */
function StillSprite({ speciesId, entry, size, box, onFail }: SpriteProps & { speciesId: number }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([seen]) => {
        if (!seen.isIntersecting) return;
        observer.disconnect();
        void trimmedFrame(speciesId, entry).then((frame) => {
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          if (!frame) return onFail(true);
          canvas.width = frame.width;
          canvas.height = frame.height;
          canvas.getContext('2d')?.drawImage(frame, 0, 0);
          const scale = Math.min(size / frame.width, size / frame.height, MAX_SCALE);
          setFit({ width: frame.width * scale, height: frame.height * scale });
        });
      },
      { rootMargin: '200px' }
    );
    observer.observe(wrap);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [speciesId, entry, size, onFail]);

  return (
    <span ref={wrapRef} aria-hidden style={box}>
      <canvas ref={canvasRef} style={{ width: fit?.width ?? 0, height: fit?.height ?? 0, imageRendering: 'pixelated' }} />
    </span>
  );
}

/** The whole Idle loop, stepped across the sheet; scaled by the frame box so no frame clips. */
function AnimatedSprite({ entry: [dir, version, w, h, frames, loopMs], size, box, onFail }: SpriteProps) {
  const scale = Math.min(size / w, size / h, MAX_SCALE);
  return (
    <span aria-hidden style={box}>
      <style>{IDLE_KEYFRAMES}</style>
      <span style={{ width: w, height: h, flex: 'none', overflow: 'hidden', transform: `scale(${scale})` }}>
        <img
          src={pmdSheetUrl(dir, 'Idle', version)}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => onFail(true)}
          className="ss-anim"
          style={
            {
              display: 'block',
              maxWidth: 'none',
              marginTop: -FACE_DOWN * h,
              imageRendering: 'pixelated',
              '--ss-shift': `-${frames * w}px`,
              animation: `ss-idle ${loopMs}ms steps(${frames}) infinite`,
            } as CSSProperties
          }
        />
      </span>
    </span>
  );
}
