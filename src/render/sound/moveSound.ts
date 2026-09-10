import Phaser from 'phaser';
import type { MoveDefinition } from '../../sim/types';
import type { MoveSoundIndex } from '../../data/types';
import moveSoundIndexData from '../../data/generated/moveSounds.json';
import { normalizedVolume } from './clipVolume';
import { MOVE_SOUND_FALLBACK_VOLUME, MOVE_SOUND_TARGET_DB } from './mix';

// Same "loaded on demand, cached forever" shape as cryAudio.ts — see that
// file's comment. The clips are static files under public/move-sounds/
// (data-pipeline/build-move-sound-index.ts transcodes them there from the
// gitignored sound/ mirror and writes this index), served with the app
// build like the cries are — no runtime dependency on the mirror. Volume is
// per-clip loudness-normalized to MOVE_SOUND_TARGET_DB — the pack's clips
// range over ~11 dB among themselves (see loudness.ts).
const MOVE_SOUND_INDEX = moveSoundIndexData as MoveSoundIndex;

function moveSoundUrl(moveId: number): string {
  return `/move-sounds/${moveId}.mp3`;
}

/** Handle for a clip started by playMoveSound — lets a caller cut it short
 * (e.g. once the attack's on-screen animation has finished) instead of
 * always letting it play out to its natural end. */
export interface MoveSoundHandle {
  stop(): void;
}

/** Plays a move's matched sound effect, if the index has one — a no-op for
 * moves the mirrored SFX pack doesn't cover (mainly generation 8+ moves;
 * see build-move-sound-index.ts's unmatched-move report). Called once per
 * move use, not once per hit target, same as showMoveLabel(). Returns a
 * handle the caller can use to stop the clip early; undefined when there's
 * no matched sound to play. */
export function playMoveSound(scene: Phaser.Scene, move: MoveDefinition): MoveSoundHandle | undefined {
  if (!MOVE_SOUND_INDEX[String(move.id)]) return undefined;

  const key = `move-sound-${move.id}`;
  // scene.sound.play(key, ...) (the shorthand used elsewhere, e.g.
  // cryAudio.ts) returns only a boolean, discarding the Sound instance — no
  // way to stop it later. Use add()+play() instead so we can hang onto the
  // instance and cut it off on demand.
  let sound: Phaser.Sound.BaseSound | undefined;
  let stopped = false;

  const startPlayback = (): void => {
    if (stopped) return;
    sound = scene.sound.add(key, {
      volume: normalizedVolume(scene, key, MOVE_SOUND_TARGET_DB, MOVE_SOUND_FALLBACK_VOLUME),
    });
    sound.once('complete', () => sound?.destroy());
    sound.play();
  };

  if (scene.cache.audio.exists(key)) {
    startPlayback();
  } else {
    // filecomplete-audio-{key} is per-file (unlike the generic 'loaderror'
    // event — see PokemonSprite.ts's loadStaticImage for why that distinction
    // matters once many loads are in flight at once), so a plain .once() here
    // is safe.
    scene.load.once(`filecomplete-audio-${key}`, startPlayback);
    scene.load.audio(key, moveSoundUrl(move.id));
    if (!scene.load.isLoading()) scene.load.start();
  }

  return {
    stop() {
      // Set even if `sound` hasn't been created yet (still loading) so
      // startPlayback() skips playing a clip that's already been cancelled.
      stopped = true;
      sound?.stop();
      sound?.destroy();
    },
  };
}
