import Phaser from 'phaser';

// Picked server-side, not bundled — see sprite-server/server.ts's /soundtracks
// routes. The mirror (sound-track/<pack>/*.mp3) is gitignored and can grow new
// pack folders (currently "emerald", "red-blue") without any client change,
// since the server lists its own directory tree live rather than this file
// hardcoding pack names or shipping a generated index. The server also
// excludes anything under MIN_TRACK_DURATION_SECONDS (10s) from the random
// pool, so every track this fetches is long enough for the loop-fade below
// to have real room to work with.
const RANDOM_TRACK_URL = '/soundtracks/random';
const BATTLE_MUSIC_KEY = 'battle-music';
const BATTLE_MUSIC_VOLUME = 0.35;
// How long the volume fade takes on each side of a loop boundary — long
// enough to smooth over the seam, short enough not to eat a big chunk out of
// even the shortest track the server will hand back.
const LOOP_FADE_MS = 3000;

interface RandomTrackResponse {
  folder: string;
  file: string;
  url: string;
}

/** The subset of BaseSound's concrete-subclass-only API (WebAudioSound,
 * HTML5AudioSound, NoAudioSound all implement it identically) that isn't on
 * the base class itself but is needed for the loop-fade below. */
interface FadeableSound extends Phaser.Sound.BaseSound {
  volume: number;
  setVolume(value: number): this;
}

/** Starts a random background track looping for the scene's lifetime, with a
 * short crossfade-style dip at each loop boundary (fades out just before the
 * track ends, fades back in as it restarts) so the repeat isn't a hard cut.
 * Called once from ArenaScene.create(), so it runs once per match (local or
 * multiplayer — both mount a fresh Arena scene per match, see PhaserGame.tsx).
 * Fire-and-forget: if sprite-server isn't running or the mirror is empty, the
 * match just plays silently rather than failing to start. */
export function playBattleMusic(scene: Phaser.Scene): void {
  fetch(RANDOM_TRACK_URL)
    .then((res) => (res.ok ? (res.json() as Promise<RandomTrackResponse>) : null))
    .then((track) => {
      if (!track) {
        console.warn('[battleMusic] no track returned by', RANDOM_TRACK_URL);
        return;
      }
      if (!scene.sys.isActive()) return;

      // 'loaderror' is generic (fires for ANY failed file in the queue, not
      // just this one — unlike filecomplete-audio-{key} below), so a plain
      // .once() here would risk consuming itself on some unrelated sprite
      // load failing first. .on() + filtering by key avoids that; there's
      // nothing to remove it since the whole scene is torn down within
      // seconds either way (new match or exit).
      scene.load.on('loaderror', (file: Phaser.Loader.File) => {
        if (file.key === BATTLE_MUSIC_KEY) console.warn('[battleMusic] failed to load track', file.src);
      });

      // filecomplete-audio-{key} is per-file (see the loaderror comment
      // above for why that distinction matters), so a plain .once() here is safe.
      scene.load.once(`filecomplete-audio-${BATTLE_MUSIC_KEY}`, () => {
        if (!scene.sys.isActive()) return;
        startLoopingWithFade(scene);
      });
      scene.load.audio(BATTLE_MUSIC_KEY, track.url);
      if (!scene.load.isLoading()) scene.load.start();
    })
    .catch((err) => {
      // no music this match — sprite-server unreachable or mirror empty
      console.warn('[battleMusic] failed to fetch a random track', err);
    });
}

function startLoopingWithFade(scene: Phaser.Scene): void {
  const sound = scene.sound.add(BATTLE_MUSIC_KEY, { loop: true, volume: BATTLE_MUSIC_VOLUME }) as FadeableSound;

  // Browsers block audio playback until a genuine user gesture unlocks the
  // page's AudioContext. PhaserGame.tsx tears down and recreates the whole
  // Phaser.Game (and with it, a brand-new AudioContext) for every match, so
  // "the player clicked something to get here" doesn't guarantee THIS
  // context is already unlocked — that click can easily land before this
  // particular context even exists. Calling .play() while locked fails
  // completely silently (no error, no sound, and Phaser never retries it on
  // its own), which is exactly the intermittent "sometimes no music" bug:
  // deferring to the manager's own 'unlocked' event instead guarantees
  // playback actually starts the moment the browser allows it, rather than
  // being lost forever if the timing was unlucky.
  if (scene.sound.locked) {
    scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
      if (scene.sys.isActive()) beginPlayback(scene, sound);
    });
    return;
  }

  beginPlayback(scene, sound);
}

function beginPlayback(scene: Phaser.Scene, sound: FadeableSound): void {
  sound.play();

  const fadeSec = LOOP_FADE_MS / 1000;
  // A track this short shouldn't reach here (see MIN_TRACK_DURATION_SECONDS
  // above) — stay defensive anyway rather than schedule overlapping fades.
  if (!Number.isFinite(sound.duration) || sound.duration <= fadeSec * 2) return;

  const fadeOutDelayMs = (sound.duration - fadeSec) * 1000;

  const scheduleFadeOut = (): void => {
    scene.time.delayedCall(fadeOutDelayMs, () => {
      if (!sound.isPlaying) return;
      scene.tweens.add({ targets: sound, volume: 0, duration: LOOP_FADE_MS, ease: 'Linear' });
    });
  };

  // Fires exactly when Phaser wraps playback back to the start — the natural
  // point to start fading back in. setVolume(0) first covers the (rare) case
  // where the fade-out tween above hasn't quite finished landing on 0 yet.
  sound.on(Phaser.Sound.Events.LOOPED, () => {
    if (!sound.isPlaying) return;
    sound.setVolume(0);
    scene.tweens.add({ targets: sound, volume: BATTLE_MUSIC_VOLUME, duration: LOOP_FADE_MS, ease: 'Linear' });
    scheduleFadeOut(); // re-arm for the next loop
  });

  scheduleFadeOut();
}
