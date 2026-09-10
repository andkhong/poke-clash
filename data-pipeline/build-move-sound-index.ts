import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import type { MoveDefinition } from '../src/sim/types';
import type { MoveSoundIndex } from '../src/data/types';
import { mapWithConcurrency } from './pokeapi';

// Matches each move in the generated dataset to a clip in the user-supplied
// sound/ mirror (gitignored — see .gitignore), then transcodes every matched
// clip into public/move-sounds/<moveId>.mp3, which IS committed and ships
// inside the app build like public/cries/ does. The mirror is 1.1 GB of
// 320 kbps stereo clips for ~4,500 moves/variants; the game references 463
// of them, and at 80 kbps mono (these are chiptune-era effects, effectively
// mono already) those come to ~12 MB — small enough to live in the repo and
// the image, so production no longer needs the mirror on a volume at all,
// and every player downloads a 25 KB clip instead of a 240 KB one. The
// small committed index (src/data/generated/moveSounds.json) records which
// moves have a clip and where each came from.
//
// Requires ffmpeg on PATH. Re-running only re-encodes clips whose source is
// newer than the existing output (or all of them with --force) and removes
// outputs for moves that no longer match.
const MOVES_JSON_PATH = new URL('../src/data/generated/moves.json', import.meta.url).pathname;
const SOUND_ROOT = new URL('../sound/', import.meta.url).pathname;
const OUTPUT_DIR = new URL('../public/move-sounds/', import.meta.url).pathname;
const INDEX_PATH = new URL('../src/data/generated/moveSounds.json', import.meta.url).pathname;

/** Encoding for the shipped clips. Mono at 80 kbps: the source packs are
 * stereo only nominally, and the arena's own loudness normalization
 * (src/render/sound/loudness.ts) already treats a mono clip as the dual-mono
 * signal WebAudio plays it as, so nothing about the balance changes. */
const FFMPEG_ARGS = ['-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '80k', '-map_metadata', '-1', '-vn'];

const execFileAsync = promisify(execFile);

// Preference order: latest generation first, for the fullest coverage (a
// newer game's SFX set includes re-recorded audio for nearly every
// older move, not just ones it introduced) and generally cleaner audio;
// falls back to older generations for anything a newer one is missing.
const GENERATION_FOLDERS = [
  'GEN 7 SFX - Attack Moves - SUMO, USUM',
  'GEN 6 SFX - Attack Moves - XY, ORAS',
  'GEN 5 SFX - Attack Moves - BLK, WHT, BLK2, WHT2',
  'GEN 4 SFX - Attack Moves - DPPL, HG, SS',
  'GEN 3 SFX - Attack Moves - RSE, FR, LG',
  'GEN 2 SFX - Attack Moves - GSC',
  'GEN 1 SFX - Attack Moves - RBY',
];

const AUDIO_EXT_RE = /\.(mp3|wav)$/i;

/** Bare normalization only — lowercase, strip the extension, drop every
 * non-alphanumeric character — so "Aurora Beam.mp3" and "AuroraBeam.wav"
 * both reduce to "aurorabeam" regardless of a generation's spacing
 * convention, but a file's own suffix markers ("part 1", "(LOOP)", ...) are
 * preserved and therefore still make it a distinct key from the bare move
 * name. Move names always use this form directly. */
function bareKey(raw: string): string {
  return raw
    .replace(AUDIO_EXT_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Strips a generation's packaging cruft (multi-part sequence markers,
 * alt-mix suffixes, loop markers, hit-count suffixes) on top of bareKey, so a
 * *filename* that's just one fragment of a move's full effect still reduces
 * to the move's own bare key as a fallback candidate — but only a fallback:
 * buildFolderIndex prefers an exact bareKey match (the complete, standalone
 * clip) over one that needed this stripping to match, so a real
 * "Smart Strike.mp3" always wins over "Smart Strike part 1.mp3" for the same
 * move when both exist. Per the pack's own README, plain numbered suffixes
 * ("Absorb1", "Absorb2") are just extra takes/split parts of the same clip,
 * not distinct sounds — deliberately NOT stripped here, so they never
 * shadow the clean base file ("Absorb") as a same-priority candidate. */
function strippedKey(raw: string): string | null {
  let s = raw.replace(AUDIO_EXT_RE, '');
  if (/^imhit/i.test(s)) return null; // generic super/not-very-effective/damage stingers, not a move
  s = s.replace(/\s*part\s*\d+$/i, '');
  s = s.replace(/\(loop\)/i, '');
  s = s.replace(/direct$/i, '');
  s = s.replace(/\s*\d+\s*hits?$/i, ''); // "Arm Thrust 1hit" / "2hits" -> same move, either is fine
  const key = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return key || null;
}

async function buildFolderIndex(folder: string): Promise<Map<string, string>> {
  let entries: string[];
  try {
    entries = await readdir(`${SOUND_ROOT}${folder}/`);
  } catch {
    return new Map(); // folder not present in this checkout — just yields no matches from it
  }
  const audioFiles = entries.filter((e) => AUDIO_EXT_RE.test(e) && !/^imhit/i.test(e));

  // Pass 1: exact bare-name files only — "Smart Strike.mp3" claims the
  // "smartstrike" key outright, so a same-move fragment can never win it.
  const index = new Map<string, string>();
  for (const entry of audioFiles) {
    const key = bareKey(entry);
    if (!index.has(key)) index.set(key, entry);
  }

  // Pass 2: fragments/variants fill in only the keys pass 1 left unclaimed
  // (e.g. "Fly", which this pack only ever splits into "Fly part 1"/"part 2").
  for (const entry of audioFiles) {
    const key = strippedKey(entry);
    if (key && !index.has(key)) index.set(key, entry);
  }

  return index;
}

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

async function transcode(source: string, output: string): Promise<void> {
  await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', source, ...FFMPEG_ARGS, output]);
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const moves = JSON.parse(await readFile(MOVES_JSON_PATH, 'utf-8')) as Record<string, MoveDefinition>;

  const folderIndexes = new Map<string, Map<string, string>>();
  for (const folder of GENERATION_FOLDERS) {
    folderIndexes.set(folder, await buildFolderIndex(folder));
  }
  for (const [folder, index] of folderIndexes) {
    console.log(`[build-move-sounds] ${folder}: ${index.size} candidate clips`);
  }

  const matched: { id: string; folder: string; file: string }[] = [];
  const unmatched: string[] = [];
  for (const [id, move] of Object.entries(moves)) {
    const key = bareKey(move.name);
    let hit: { folder: string; file: string } | undefined;
    for (const folder of GENERATION_FOLDERS) {
      const candidate = folderIndexes.get(folder)?.get(key);
      if (candidate) {
        hit = { folder, file: candidate };
        break;
      }
    }
    if (hit) matched.push({ id, ...hit });
    else unmatched.push(move.name);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Transcode what's new or changed.
  let encoded = 0;
  let skipped = 0;
  let failed = 0;
  const result: MoveSoundIndex = {};
  await mapWithConcurrency(
    matched,
    async ({ id, folder, file }) => {
      const source = `${SOUND_ROOT}${folder}/${file}`;
      const output = `${OUTPUT_DIR}${id}.mp3`;
      const [sourceTime, outputTime] = await Promise.all([mtimeMs(source), mtimeMs(output)]);
      if (!force && outputTime !== null && sourceTime !== null && outputTime >= sourceTime) {
        skipped += 1;
      } else {
        try {
          await transcode(source, output);
          encoded += 1;
        } catch (err) {
          failed += 1;
          console.warn(`[build-move-sounds] ${id} (${folder}/${file}): ${(err as Error).message}`);
          return;
        }
      }
      result[id] = { source: `${folder}/${file}` };
    },
    undefined,
    Math.max(2, cpus().length - 1)
  );

  // Drop outputs for moves that no longer match anything.
  let removed = 0;
  for (const entry of await readdir(OUTPUT_DIR)) {
    const id = entry.replace(/\.mp3$/i, '');
    if (entry.endsWith('.mp3') && !result[id]) {
      await rm(`${OUTPUT_DIR}${entry}`);
      removed += 1;
    }
  }

  // Sorted by numeric move id so the committed index diffs cleanly.
  const sorted: MoveSoundIndex = {};
  for (const id of Object.keys(result).sort((a, b) => Number(a) - Number(b))) sorted[id] = result[id];
  await writeFile(INDEX_PATH, JSON.stringify(sorted), 'utf-8');

  const total = Object.keys(moves).length;
  console.log(
    `[build-move-sounds] matched ${matched.length}/${total} moves; encoded ${encoded}, up to date ${skipped}, failed ${failed}, removed ${removed} stale`
  );
  console.log(`[build-move-sounds] wrote ${Object.keys(sorted).length} clips to ${OUTPUT_DIR} and ${INDEX_PATH}`);
  if (unmatched.length > 0) {
    console.log(`[build-move-sounds] unmatched (${unmatched.length}), likely gen 8+ moves the pack doesn't cover:`);
    console.log(unmatched.sort().join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
