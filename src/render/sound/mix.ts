/**
 * The arena's mix, in one place. Every clip is loudness-normalized to its
 * category's target — cries and move SFX at play time (clipVolume.ts), music
 * offline when the soundtrack is prepared for deployment
 * (data-pipeline/build-soundtrack.ts, same meter) since it's streamed rather
 * than decoded up front — so these three numbers *are* the balance: retune
 * here, not in the players (and re-run the soundtrack build for music).
 *
 * Calibrated against the reference battle footage in examples/ (three
 * clips, measured with ffmpeg's ebur128): those sit at -14 to -17 LUFS
 * integrated, with the music bed holding around -20 to -21 LUFS between
 * events and cries/attack hits peaking 7-10 dB above it, at roughly -10 to
 * -13 LUFS. Before this, our music played near -25 LUFS (a 0.35 flat gain
 * on tracks that vary 6+ dB among themselves), cries near -16 and move SFX
 * near -18 but each straddling a 10 dB range from clip to clip — quieter
 * overall than the reference and uneven within every category.
 *
 * Targets are LUFS as loudness.ts measures them (BS.1770, as heard through
 * a stereo output — the same thing ffmpeg reports for the reference clips,
 * once a mono file is counted as the dual-mono signal it plays back as).
 * Music sits at the reference's bed; move SFX 8 dB above it; cries a touch
 * lower than SFX, because the intro pops every Pokéball 130ms apart, so up
 * to a dozen cries overlap there and that pile-up adds up to far more than
 * any one of them.
 *
 * Pure constants, no DOM or Phaser types — the data pipeline imports the
 * music target from here. The master limiter that goes with these lives in
 * masterBus.ts.
 */
export const MUSIC_TARGET_DB = -21;
export const CRY_TARGET_DB = -15;
export const MOVE_SOUND_TARGET_DB = -13;

/** Flat per-category gains for the HTML5-audio fallback, where there are no
 * decoded samples to measure (see normalizedVolume in clipVolume.ts) — sized
 * for a typical clip in each pack and kept a little conservative, since the
 * master limiter is WebAudio-only too. Music needs none: it's normalized in
 * the file itself. */
export const CRY_FALLBACK_VOLUME = 0.45;
export const MOVE_SOUND_FALLBACK_VOLUME = 0.6;

/** Master limiter settings (a WebAudio DynamicsCompressorNode used as a
 * brick-wall-ish peak limiter — see masterBus.ts). The normalized targets
 * above are hot enough that a cry landing on a music peak, or the intro's
 * dozen overlapping cries, would otherwise sum past full scale and
 * hard-clip — the browser's output simply truncates anything over 1.0,
 * which is the harshest kind of distortion. A high-ratio, fast, -6 dBFS
 * threshold catches exactly those sums and nothing else: music at its
 * target peaks around -8 dBFS and never touches it, a lone cry or SFX
 * brushes it at most lightly. */
export const MASTER_LIMITER = {
  thresholdDb: -6,
  kneeDb: 4,
  ratio: 12,
  attackS: 0.002,
  releaseS: 0.12,
} as const;
