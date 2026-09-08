import Phaser from 'phaser';
import type { MoveDefinition } from '../../sim/types';
import type { MoveSoundIndex } from '../../data/types';
import moveSoundIndexData from '../../data/generated/moveSounds.json';

// Same "downloaded/mirrored locally, loaded on demand, cached forever" shape
// as cryAudio.ts — see that file's comment. The clips themselves live in the
// gitignored sound/ mirror (data-pipeline/build-move-sound-index.ts produces
// this index from it) and are served root-relative via sprite-server/'s
// /move-sounds route, proxied by Vite in dev the same way /pmd-sprites is.
const MOVE_SOUND_INDEX = moveSoundIndexData as MoveSoundIndex;
const MOVE_SOUND_VOLUME = 0.5;

function moveSoundUrl(folder: string, file: string): string {
  return `/move-sounds/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`;
}

/** Plays a move's matched sound effect, if the index has one — a no-op for
 * moves the mirrored SFX pack doesn't cover (mainly generation 8+ moves;
 * see build-move-sound-index.ts's unmatched-move report). Called once per
 * move use, not once per hit target, same as showMoveLabel(). */
export function playMoveSound(scene: Phaser.Scene, move: MoveDefinition): void {
  const entry = MOVE_SOUND_INDEX[String(move.id)];
  if (!entry) return;

  const key = `move-sound-${move.id}`;
  if (scene.cache.audio.exists(key)) {
    scene.sound.play(key, { volume: MOVE_SOUND_VOLUME });
    return;
  }

  // filecomplete-audio-{key} is per-file (unlike the generic 'loaderror'
  // event — see PokemonSprite.ts's loadStaticImage for why that distinction
  // matters once many loads are in flight at once), so a plain .once() here
  // is safe.
  scene.load.once(`filecomplete-audio-${key}`, () => {
    scene.sound.play(key, { volume: MOVE_SOUND_VOLUME });
  });
  scene.load.audio(key, moveSoundUrl(entry.folder, entry.file));
  if (!scene.load.isLoading()) scene.load.start();
}
