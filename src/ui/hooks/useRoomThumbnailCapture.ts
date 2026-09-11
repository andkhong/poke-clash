import { useEffect, useRef } from 'react';
import type { RoomPhase } from '../../net/protocol';

/** How often a watching client uploads a fresh frame while a battle is live —
 * frequent enough that the landing page's room grid feels current, loose
 * enough that several simultaneous viewers of the same room don't spam the
 * server (see game-server's THUMBNAIL_MIN_INTERVAL_MS, a second line of
 * defense against that). */
const CAPTURE_INTERVAL_MS = 7000;
/** A short head start on the first capture, rather than waiting a full
 * CAPTURE_INTERVAL_MS, so a room that just started battling gets a thumbnail
 * quickly instead of showing the placeholder for most of that interval. */
const FIRST_CAPTURE_DELAY_MS = 1200;
/** Downscale target — a room-grid card is small, and this keeps every
 * upload well under the server's MAX_THUMBNAIL_BYTES. */
const THUMBNAIL_WIDTH_PX = 320;

/** Periodically grabs a downscaled frame off `canvas` and uploads it as this
 * room's live thumbnail (POST /api/rooms/:id/thumbnail) for as long as this
 * client is watching a battle in progress — whoever's currently watching a
 * room is the source of its "live" thumbnail, the same way a broadcaster's
 * own encoder is the source of a Twitch one. A room nobody's watching just
 * keeps serving its last cached frame. `enabled` is a plain gate (e.g. false
 * for the always-on showcase room, which isn't shown in the grid) rather
 * than a conditional hook call, per the rules of hooks. */
export function useRoomThumbnailCapture(
  roomId: string,
  phase: RoomPhase | undefined,
  canvas: HTMLCanvasElement | null,
  enabled: boolean
): void {
  const uploadingRef = useRef(false);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || phase !== 'battle' || !canvas) return;

    const capture = () => {
      if (uploadingRef.current) return;
      // A backgrounded tab gets its rendering throttled by the browser —
      // Phaser stops producing fresh frames, so a capture taken then would
      // just be whatever stale/cleared content is left in the buffer.
      // Skipping is better than uploading that over a good cached frame.
      if (document.hidden) return;
      const sourceWidth = canvas.width;
      const sourceHeight = canvas.height;
      if (sourceWidth === 0 || sourceHeight === 0) return;

      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      const offscreen = offscreenRef.current;
      const targetWidth = Math.min(THUMBNAIL_WIDTH_PX, sourceWidth);
      const targetHeight = Math.round((targetWidth / sourceWidth) * sourceHeight);
      offscreen.width = targetWidth;
      offscreen.height = targetHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

      offscreen.toBlob((blob) => {
        if (!blob) return;
        uploadingRef.current = true;
        fetch(`/api/rooms/${roomId}/thumbnail`, { method: 'POST', body: blob })
          .catch(() => {
            // Best-effort — a dropped capture just leaves the cached
            // thumbnail stale a bit longer, nothing to recover from here.
          })
          .finally(() => {
            uploadingRef.current = false;
          });
      }, 'image/png');
    };

    const firstCapture = setTimeout(capture, FIRST_CAPTURE_DELAY_MS);
    const interval = setInterval(capture, CAPTURE_INTERVAL_MS);
    return () => {
      clearTimeout(firstCapture);
      clearInterval(interval);
    };
  }, [roomId, phase, canvas, enabled]);
}
