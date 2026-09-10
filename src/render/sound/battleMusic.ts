import Phaser from 'phaser';
import { loopFadeEnvelope } from './loopFade';
import { getWebAudioBus } from './masterBus';

// Picked server-side, not bundled — see sprite-server/server.ts's /soundtracks
// routes. The mirror (sound-track/<pack>/*.mp3) is gitignored and can grow new
// pack folders (currently "emerald", "red-blue") without any client change,
// since the server lists its own directory tree live rather than this file
// hardcoding pack names or shipping a generated index. The server also
// excludes anything under MIN_TRACK_DURATION_SECONDS (10s) from the random
// pool, so every track this fetches is long enough for the loop-fade below
// to have real room to work with.
//
// Streamed through an <audio> element rather than loaded as a Phaser sound:
// Phaser's loader downloads the whole file and decodes it to PCM before the
// first note (a 3-minute stereo track is ~60-100 MB of samples, a real cost
// on a phone, and the intro could run for seconds in silence on a slow
// connection), whereas a media element starts playing after the first few
// hundred KB arrive. Under WebAudio the element is routed into Phaser's own
// graph via a MediaElementAudioSourceNode, so the master mute/volume and
// the limiter (see mix.ts) still apply and the loop fade is a GainNode ramp;
// with the HTML5/no-audio managers it just plays on its own. Level: the
// tracks are loudness-normalized in the file (data-pipeline/build-soundtrack.ts),
// so the element plays at unity.
const RANDOM_TRACK_URL = '/soundtracks/random';
/** Time constant of the GainNode ramp that follows the loop-fade envelope
 * (see loopFade.ts) — timeupdate only fires ~4x/s, so the ramp is what
 * keeps the fade from stepping. */
const FADE_SMOOTHING_S = 0.1;

interface RandomTrackResponse {
  folder: string;
  file: string;
  url: string;
}

/** Starts a random background track looping for the scene's lifetime.
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
      startStreaming(scene, track.url);
    })
    .catch((err) => {
      // no music this match — sprite-server unreachable or mirror empty
      console.warn('[battleMusic] failed to fetch a random track', err);
    });
}

function startStreaming(scene: Phaser.Scene, url: string): void {
  const element = document.createElement('audio');
  element.loop = true;
  element.preload = 'auto';
  // Same-origin in every deployment (Vite proxy in dev, Caddy in prod), but a
  // MediaElementAudioSourceNode outputs silence for a tainted cross-origin
  // element, so be explicit that CORS is expected should that ever change.
  element.crossOrigin = 'anonymous';
  element.src = url;

  const bus = getWebAudioBus(scene.sound);
  let gain: GainNode | undefined;
  let source: MediaElementAudioSourceNode | undefined;
  if (bus) {
    source = bus.context.createMediaElementSource(element);
    gain = bus.context.createGain();
    source.connect(gain);
    gain.connect(bus.destination);
  }

  let loopedOnce = false;
  let lastTime = 0;
  const onTimeUpdate = (): void => {
    // The loop wraps currentTime back to ~0 — that's the only way it can go
    // backwards on a track nobody seeks.
    if (element.currentTime < lastTime - 1) loopedOnce = true;
    lastTime = element.currentTime;
    const level = loopFadeEnvelope(element.currentTime, element.duration, loopedOnce);
    if (gain && bus) gain.gain.setTargetAtTime(level, bus.context.currentTime, FADE_SMOOTHING_S);
    else element.volume = level;
  };
  element.addEventListener('timeupdate', onTimeUpdate);
  element.addEventListener('error', () => console.warn('[battleMusic] failed to stream track', url));

  // The element lives outside Phaser, so it has to be torn down with the
  // scene by hand — PhaserGame.tsx destroys the whole game per match, which
  // destroys this scene, and a scene restart would shut it down.
  const teardown = (): void => {
    element.removeEventListener('timeupdate', onTimeUpdate);
    element.pause();
    element.removeAttribute('src');
    element.load();
    source?.disconnect();
    gain?.disconnect();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
  scene.events.once(Phaser.Scenes.Events.DESTROY, teardown);

  beginPlayback(scene, element);
}

/** Browsers block audio until a genuine user gesture unlocks the page, and
 * PhaserGame.tsx builds a brand-new AudioContext for every match, so "the
 * player clicked something to get here" doesn't guarantee THIS context is
 * unlocked yet. Phaser tracks that for its context (`locked` + the UNLOCKED
 * event); the element's own play() can additionally be refused, in which
 * case it's retried on the next gesture. Starting the element while the
 * context is still suspended would run the track silently (its output is
 * routed into that context), so wait for the unlock first. */
function beginPlayback(scene: Phaser.Scene, element: HTMLAudioElement): void {
  const attempt = (): void => {
    if (!scene.sys.isActive()) return;
    element.play().catch(() => retryOnGesture(scene, attempt));
  };
  if (scene.sound.locked) {
    scene.sound.once(Phaser.Sound.Events.UNLOCKED, attempt);
    return;
  }
  attempt();
}

function retryOnGesture(scene: Phaser.Scene, retry: () => void): void {
  const once = (): void => {
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    if (scene.sys.isActive()) retry();
  };
  window.addEventListener('pointerdown', once);
  window.addEventListener('keydown', once);
}
