import { execFile } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { measureLoudnessDb, peakLimitedGain, type PcmClip } from '../src/render/sound/loudness';
import { MUSIC_TARGET_DB } from '../src/render/sound/mix';
import { mapWithConcurrency } from './pokeapi';

// Turns the user-supplied background-music mirror (sound-track/<pack>/*.mp3,
// gitignored — ~446 MB of 240 kbps rips with embedded cover art) into the
// tree that actually gets uploaded to the production volume as
// /data/sound-track (deploy-assets/sound-track/<pack>/*.mp3, also
// gitignored): same pack/file layout so sprite-server needs no change, but
// each track is
//
// - re-encoded at 128 kbps with the cover art and tags stripped (about half
//   the bytes a player streams per match), and
// - loudness-normalized offline to MUSIC_TARGET_DB. The arena used to
//   measure each track at play time (src/render/sound/loudness.ts), which
//   meant downloading and decoding the whole file before the first note;
//   battleMusic.ts now streams a track through an <audio> element instead,
//   so the measuring has to happen here. Same BS.1770 meter, applied as a
//   plain linear gain (never a dynamics process), capped so the track's
//   sample peak stays under PEAK_CEILING_DBFS — a very quiet rip that can't
//   reach the target without clipping is left a little quiet rather than
//   distorted (the count is reported).
//
// Requires ffmpeg on PATH. Re-running only re-encodes tracks whose source is
// newer than the existing output (or all of them with --force).
const SOURCE_ROOT = new URL('../sound-track/', import.meta.url).pathname;
const OUTPUT_ROOT = new URL('../deploy-assets/sound-track/', import.meta.url).pathname;
const SAMPLE_RATE = 44_100;
const BITRATE = '128k';
const PEAK_CEILING_DBFS = -1;
const AUDIO_EXT_RE = /\.(mp3|ogg|wav)$/i;

const execFileAsync = promisify(execFile);

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** Decodes to 44.1 kHz stereo float PCM the way the browser would, as a
 * PcmClip the shared meter accepts. */
async function decode(path: string): Promise<{ clip: PcmClip; samplePeak: number }> {
  const { stdout } = await execFileAsync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-vn', '-f', 'f32le', '-ac', '2', '-ar', String(SAMPLE_RATE), '-'],
    { encoding: 'buffer', maxBuffer: 1 << 30 }
  );
  const interleaved = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
  const frames = Math.floor(interleaved.length / 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  let samplePeak = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = interleaved[i * 2];
    right[i] = interleaved[i * 2 + 1];
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (peak > samplePeak) samplePeak = peak;
  }
  const channels = [left, right];
  return {
    clip: { sampleRate: SAMPLE_RATE, length: frames, numberOfChannels: 2, getChannelData: (c) => channels[c] },
    samplePeak,
  };
}

async function encode(source: string, output: string, gain: number): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y',
    '-i', source,
    '-vn', '-map_metadata', '-1',
    '-af', `volume=${gain.toFixed(6)}`,
    '-ar', String(SAMPLE_RATE),
    '-c:a', 'libmp3lame', '-b:a', BITRATE,
    output,
  ]);
}

interface Job {
  pack: string;
  file: string;
}

async function listJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  let packs: string[];
  try {
    packs = (await readdir(SOURCE_ROOT, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.error(`[build-soundtrack] no sound-track/ mirror at ${SOURCE_ROOT}`);
    return [];
  }
  for (const pack of packs.sort()) {
    const files = (await readdir(join(SOURCE_ROOT, pack), { withFileTypes: true }))
      .filter((e) => e.isFile() && AUDIO_EXT_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const file of files) jobs.push({ pack, file });
  }
  return jobs;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const jobs = await listJobs();
  console.log(`[build-soundtrack] ${jobs.length} tracks across ${new Set(jobs.map((j) => j.pack)).size} pack(s)`);

  let encoded = 0;
  let skipped = 0;
  let failed = 0;
  let peakLimited = 0;
  let silent = 0;
  const bytes: Record<string, { before: number; after: number }> = {};

  await mapWithConcurrency(
    jobs,
    async ({ pack, file }) => {
      const source = join(SOURCE_ROOT, pack, file);
      const output = join(OUTPUT_ROOT, pack, file.replace(AUDIO_EXT_RE, '.mp3'));
      await mkdir(join(OUTPUT_ROOT, pack), { recursive: true });
      const [sourceTime, outputTime] = await Promise.all([mtimeMs(source), mtimeMs(output)]);
      if (!force && outputTime !== null && sourceTime !== null && outputTime >= sourceTime) {
        skipped += 1;
      } else {
        try {
          const { clip, samplePeak } = await decode(source);
          const measured = measureLoudnessDb(clip);
          let gain = 1;
          if (measured === null) {
            silent += 1;
          } else {
            const wanted = Math.pow(10, (MUSIC_TARGET_DB - measured) / 20);
            gain = peakLimitedGain(measured, MUSIC_TARGET_DB, samplePeak, PEAK_CEILING_DBFS);
            if (gain < wanted - 1e-6) peakLimited += 1;
          }
          await encode(source, output, gain);
          encoded += 1;
        } catch (err) {
          failed += 1;
          console.warn(`[build-soundtrack] ${pack}/${file}: ${(err as Error).message}`);
          return;
        }
      }
      const [before, after] = await Promise.all([stat(source), stat(output)]);
      bytes[pack] ??= { before: 0, after: 0 };
      bytes[pack].before += before.size;
      bytes[pack].after += after.size;
    },
    (done, total) => {
      if (done % 25 === 0 || done === total) console.log(`[build-soundtrack] ${done}/${total}`);
    },
    Math.max(2, cpus().length - 1)
  );

  console.log(
    `[build-soundtrack] encoded ${encoded}, up to date ${skipped}, failed ${failed}; ${peakLimited} held under target by the ${PEAK_CEILING_DBFS} dBFS peak ceiling, ${silent} silent`
  );
  for (const [pack, b] of Object.entries(bytes)) {
    console.log(`[build-soundtrack] ${pack}: ${(b.before / 1048576).toFixed(0)} MB -> ${(b.after / 1048576).toFixed(0)} MB`);
  }
  console.log(`[build-soundtrack] wrote ${OUTPUT_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
