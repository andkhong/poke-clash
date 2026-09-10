// Pure envelope math for battleMusic.ts's loop fade — kept apart from the
// player so it can be unit-tested without Phaser or a DOM.

/** How long the volume fade takes on each side of a loop boundary — long
 * enough to smooth over the seam, short enough not to eat a big chunk out
 * of even the shortest track the server will hand back (see
 * MIN_TRACK_DURATION_SECONDS in sprite-server/server.ts). */
export const LOOP_FADE_S = 3;

/**
 * Volume envelope for a looping track at `currentTime`: full most of the
 * way, ramping down over the last `fadeS` seconds and — once the track has
 * wrapped at least once — back up over the first `fadeS` after the seam, so
 * the repeat isn't a hard cut. The very first play starts at full volume
 * rather than fading in. Unknown duration (metadata not loaded yet) means
 * full volume.
 */
export function loopFadeEnvelope(currentTime: number, duration: number, loopedOnce: boolean, fadeS = LOOP_FADE_S): number {
  if (!Number.isFinite(duration) || duration <= 0 || fadeS <= 0) return 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const fadeOut = clamp((duration - currentTime) / fadeS);
  const fadeIn = loopedOnce ? clamp(currentTime / fadeS) : 1;
  return Math.min(fadeOut, fadeIn);
}
