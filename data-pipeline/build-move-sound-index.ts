import { readFile, readdir, writeFile } from 'node:fs/promises';
import type { MoveDefinition } from '../src/sim/types';
import type { MoveSoundIndex } from '../src/data/types';

// Matches each move in the generated dataset to a clip in the user-supplied
// sound/ mirror (gitignored — see .gitignore and sprite-server/server.ts,
// which serves it the same way pmd-sprite-mirror/ is served). Produces a
// small committed index (src/data/generated/moveSounds.json) so the client
// never has to fuzzy-match filenames at runtime.
const MOVES_JSON_PATH = new URL('../src/data/generated/moves.json', import.meta.url).pathname;
const SOUND_ROOT = new URL('../sound/', import.meta.url).pathname;
const OUTPUT_PATH = new URL('../src/data/generated/moveSounds.json', import.meta.url).pathname;

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

async function main(): Promise<void> {
  const moves = JSON.parse(await readFile(MOVES_JSON_PATH, 'utf-8')) as Record<string, MoveDefinition>;

  const folderIndexes = new Map<string, Map<string, string>>();
  for (const folder of GENERATION_FOLDERS) {
    folderIndexes.set(folder, await buildFolderIndex(folder));
  }
  for (const [folder, index] of folderIndexes) {
    console.log(`[build-move-sound-index] ${folder}: ${index.size} candidate clips`);
  }

  const result: MoveSoundIndex = {};
  const unmatched: string[] = [];

  for (const [id, move] of Object.entries(moves)) {
    const key = bareKey(move.name);
    let file: string | undefined;
    let matchedFolder: string | undefined;
    for (const folder of GENERATION_FOLDERS) {
      const candidate = folderIndexes.get(folder)?.get(key);
      if (candidate) {
        file = candidate;
        matchedFolder = folder;
        break;
      }
    }
    if (file && matchedFolder) {
      result[id] = { folder: matchedFolder, file };
    } else {
      unmatched.push(move.name);
    }
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(result), 'utf-8');

  const total = Object.keys(moves).length;
  console.log(`[build-move-sound-index] matched ${total - unmatched.length}/${total} moves`);
  console.log(`[build-move-sound-index] wrote ${OUTPUT_PATH}`);
  if (unmatched.length > 0) {
    console.log(`[build-move-sound-index] unmatched (${unmatched.length}), likely gen 8+ moves the pack doesn't cover:`);
    console.log(unmatched.sort().join(', '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
