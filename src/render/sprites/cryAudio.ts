import Phaser from 'phaser';

// Downloaded locally (data-pipeline/fetch-cries.ts -> public/cries/) rather
// than hotlinked, so playback has zero dependency on a third-party CDN — the
// files are served same-origin as static assets.
const CRY_PATH = (speciesId: number) => `/cries/${speciesId}.ogg`;
const CRY_VOLUME = 0.45;

/** Loads (if needed) and plays a species' cry — fired when its Pokéball pops open. */
export function playCry(scene: Phaser.Scene, speciesId: number): void {
  const key = `cry-${speciesId}`;

  if (scene.cache.audio.exists(key)) {
    scene.sound.play(key, { volume: CRY_VOLUME });
    return;
  }

  // filecomplete-audio-{key} is per-file (unlike the generic 'loaderror'
  // event — see loadStaticImage's fix), so a plain .once() here is safe.
  scene.load.once(`filecomplete-audio-${key}`, () => {
    scene.sound.play(key, { volume: CRY_VOLUME });
  });
  scene.load.audio(key, CRY_PATH(speciesId));
  if (!scene.load.isLoading()) scene.load.start();
}
