import Phaser from 'phaser';
import { normalizedVolume } from '../sound/loudness';
import { CRY_FALLBACK_VOLUME, CRY_TARGET_DB } from '../sound/mix';

// Downloaded locally (data-pipeline/fetch-cries.ts -> public/cries/) rather
// than hotlinked, so playback has zero dependency on a third-party CDN — the
// files are served same-origin as static assets.
const CRY_PATH = (speciesId: number) => `/cries/${speciesId}.ogg`;

/** Loads (if needed) and plays a species' cry — fired when its Pokéball pops
 * open. Volume is per-clip loudness-normalized to CRY_TARGET_DB (the cry
 * files themselves range over ~10 dB — see loudness.ts). */
export function playCry(scene: Phaser.Scene, speciesId: number): void {
  const key = `cry-${speciesId}`;
  const play = (): void => {
    scene.sound.play(key, { volume: normalizedVolume(scene, key, CRY_TARGET_DB, CRY_FALLBACK_VOLUME) });
  };

  if (scene.cache.audio.exists(key)) {
    play();
    return;
  }

  // filecomplete-audio-{key} is per-file (unlike the generic 'loaderror'
  // event — see loadStaticImage's fix), so a plain .once() here is safe.
  scene.load.once(`filecomplete-audio-${key}`, play);
  scene.load.audio(key, CRY_PATH(speciesId));
  if (!scene.load.isLoading()) scene.load.start();
}
