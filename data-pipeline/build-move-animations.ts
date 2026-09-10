import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { MoveDefinition } from '../src/sim/types';
import { STRUGGLE_MOVE } from '../src/sim/struggle';
import type { GeneratedSpecies, MoveAnimationIndex, MoveAnimationIndexEntry } from '../src/data/types';
import {
  ANIM_CELL_SIZE,
  ANIM_TARGET_X,
  ANIM_TARGET_Y,
  ANIM_USER_X,
  ANIM_USER_Y,
  type MoveAnimationBattlerCell,
  type MoveAnimationCell,
  type MoveAnimationData,
  type MoveAnimationFrame,
  type MoveAnimationSfxCue,
} from '../src/data/moveAnimationFormat';
import { isRubyObject, marshalLoad, type RubyObject, type RubyValue } from './rubyMarshal';
import { mapWithConcurrency } from './pokeapi';
import { optimizePng } from './pngOptimize';

// Converts the Gen 9 Move Animation Project (a Pokémon Essentials animation
// pack — Data/PkmnAnimations.rxdata plus Graphics/Animations/*.png, dropped
// unzipped into the repo root, gitignored) into what the arena actually
// plays:
//
// - public/move-anims/moves/<moveId>.json — one compact animation per move
//   in the generated dataset (plus Struggle), see
//   src/data/moveAnimationFormat.ts for the tuple layout. Committed and
//   shipped with the build like public/move-sounds/, fetched on demand.
// - public/move-anims/common/<name>.json — the pack's status-condition
//   animations (Common:Poison, Common:Burn, ...), same format.
// - public/move-anims/sheets/<slug>.png — only the sheets those animations
//   reference (~260 of the pack's 680), palette-encoded (see
//   pngOptimize.ts). An animation with a non-zero hue gets its own
//   hue-rotated copy of the sheet, since Phaser has no per-sprite hue shift.
// - src/data/generated/moveAnimations.json — the small index the client
//   bundles: which sheet each move needs (so it can be fetched alongside
//   the JSON), frame count, and whether the animation dashes the attacker
//   into the target (the melee-vs-ranged pose cue).
//
// Every move reachable in play (in a PMD-sprite species' learnset, the same
// rule loader.ts uses) must match an animation or this exits non-zero;
// unreachable dataset moves only warn. Re-running only re-encodes sheets
// whose source is newer than the existing output (or all with --force).

const PACK_ROOT = process.env.MOVE_ANIM_PACK_DIR ?? fileURLToPath(new URL('../Gen 9 Move Animation Project/', import.meta.url));
const RXDATA_PATH = join(PACK_ROOT, 'Data', 'PkmnAnimations.rxdata');
const SHEET_SOURCE_DIR = join(PACK_ROOT, 'Graphics', 'Animations');

const MOVES_JSON_PATH = fileURLToPath(new URL('../src/data/generated/moves.json', import.meta.url));
const POKEMON_JSON_PATH = fileURLToPath(new URL('../src/data/generated/pokemon.json', import.meta.url));
const PMD_SPRITE_IDS_PATH = fileURLToPath(new URL('../src/data/generated/pmdSpriteIds.json', import.meta.url));
const OUTPUT_ROOT = fileURLToPath(new URL('../public/move-anims/', import.meta.url));
const MOVES_OUTPUT_DIR = join(OUTPUT_ROOT, 'moves');
const COMMON_OUTPUT_DIR = join(OUTPUT_ROOT, 'common');
const SHEETS_OUTPUT_DIR = join(OUTPUT_ROOT, 'sheets');
const INDEX_PATH = fileURLToPath(new URL('../src/data/generated/moveAnimations.json', import.meta.url));

/** Moves whose pack animation isn't filed under the normalized move name. */
const ANIMATION_NAME_ALIASES: Record<string, string> = {
  VICEGRIP: 'Move:VISEGRIP',
  TERABLAST: 'tera blast placeholder',
  IVYCUDGEL: 'ivy cudgel grass placeholder',
  HARDPRESS: 'hard press placeholder',
};

/** The pack's status/stat animations worth shipping alongside the moves.
 * The arena plays the five status conditions today (see PokemonSprite.ts's
 * ambient status VFX); the rest are converted so a later pass can use them
 * without touching the pipeline. */
const COMMON_ANIMATIONS = [
  'Poison',
  'Toxic',
  'Burn',
  'Paralysis',
  'Frozen',
  'Sleep',
  'Confusion',
  'Attract',
  'Drowsy',
  'StatUp',
  'StatDown',
  'HealthUp',
  'HealthDown',
];

/** How far (px, in the pack's 512x384 space, along the user->target line)
 * the user sprite has to be dashed before the animation counts as a melee
 * strike for the attacker's pose. Tackle-style dashes go ~200px; ranged
 * moves nudge the user by at most a few px of recoil. */
const MELEE_DASH_THRESHOLD_PX = 40;
/** An animation whose cells are at least this much screen-anchored (focus
 * 4) is a screen-wide effect — see MoveAnimationIndexEntry.screen. Below
 * this the screen cells are incidental (a flash, a backdrop) and the
 * battler-anchored rest still reads in the arena. */
const SCREEN_FOCUS_FRACTION = 0.5;
/** Timing entries that set a full-screen background/foreground image or
 * color: an animation with no cells of its own that relies on these is a
 * screen-wide effect too. */
const SCREEN_OVERLAY_TIMING_TYPES = new Set([1, 2, 3, 4]);

/** Raw Essentials cell layout (PBAnimation's AnimFrame constants, 27
 * entries). FOCUS is passed through untouched; its meaning (1 target,
 * 2 user, 3 line, 4 screen — measured from the pack's data) is documented
 * on the output format's Cell table. */
const RAW = {
  X: 0,
  Y: 1,
  ZOOM_X: 2,
  ANGLE: 3,
  MIRROR: 4,
  BLEND: 5,
  VISIBLE: 6,
  PATTERN: 7,
  OPACITY: 8,
  ZOOM_Y: 11,
  COLOR_R: 12,
  COLOR_G: 13,
  COLOR_B: 14,
  COLOR_A: 15,
  PRIORITY: 25,
  FOCUS: 26,
} as const;
const PATTERN_USER = -1;
const PATTERN_TARGET = -2;

interface PackAnimation {
  name: string;
  graphic: string;
  hue: number;
  position: 1 | 2 | 3 | 4;
  frames: (RubyValue[] | null)[];
  timing: RubyObject[];
  /** True when the timing track sets a full-screen background/foreground
   * image or color (types 1-4), none of which the conversion ships. */
  hasScreenOverlay: boolean;
}

function normalizeMoveName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function slugify(graphic: string): string {
  const slug = graphic
    .replace(/\.png$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'sheet';
}

function num(value: RubyValue, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function str(value: RubyValue, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function readPack(bytes: Uint8Array): PackAnimation[] {
  const root = marshalLoad(bytes);
  if (!isRubyObject(root) || root.className !== 'PBAnimations') {
    throw new Error(`expected a PBAnimations root, got ${isRubyObject(root) ? root.className : typeof root}`);
  }
  const entries = root.ivars.array;
  if (!Array.isArray(entries)) throw new Error('PBAnimations has no @array');
  const animations: PackAnimation[] = [];
  for (const entry of entries) {
    if (!isRubyObject(entry) || entry.className !== 'PBAnimation') continue;
    const frames = Array.isArray(entry.ivars.array) ? entry.ivars.array : [];
    const timing = Array.isArray(entry.ivars.timing) ? entry.ivars.timing.filter(isRubyObject) : [];
    const position = num(entry.ivars.position, 3);
    animations.push({
      name: str(entry.ivars.name),
      graphic: str(entry.ivars.graphic),
      hue: Math.round(num(entry.ivars.hue)) % 360,
      position: position >= 1 && position <= 4 ? (position as 1 | 2 | 3 | 4) : 3,
      frames: frames.map((frame) => (Array.isArray(frame) ? frame : null)),
      timing,
      hasScreenOverlay: timing.some((entry) => SCREEN_OVERLAY_TIMING_TYPES.has(num(entry.ivars.timingType))),
    });
  }
  return animations;
}

interface SheetSource {
  /** Actual filename under Graphics/Animations (the pack references sheets
   * case-insensitively and sometimes without the extension). */
  file: string;
  width: number;
  height: number;
}

async function indexSheetSources(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const file of await readdir(SHEET_SOURCE_DIR)) {
    if (!/\.png$/i.test(file)) continue;
    byKey.set(file.toLowerCase().replace(/\.png$/, ''), file);
  }
  return byKey;
}

interface SheetJob {
  slug: string;
  source: SheetSource;
  hue: number;
}

/** Assigns each (sheet, hue) pair a unique output slug, resolving the rare
 * case of two differently-named source files slugifying identically. */
class SheetRegistry {
  private readonly jobs = new Map<string, SheetJob>();
  private readonly slugOwner = new Map<string, string>();

  constructor(
    private readonly sourcesByKey: Map<string, string>,
    private readonly dimensions: Map<string, { width: number; height: number }>
  ) {}

  async resolve(graphic: string, hue: number): Promise<{ slug: string; columns: number } | null> {
    const key = graphic.toLowerCase().replace(/\.png$/, '');
    const file = this.sourcesByKey.get(key);
    if (!file) return null;
    let dims = this.dimensions.get(file);
    if (!dims) {
      const meta = await sharp(join(SHEET_SOURCE_DIR, file)).metadata();
      dims = { width: meta.width ?? 0, height: meta.height ?? 0 };
      this.dimensions.set(file, dims);
    }
    const jobKey = `${file} ${hue}`;
    let job = this.jobs.get(jobKey);
    if (!job) {
      let base = slugify(file);
      for (let n = 2; this.slugOwner.has(base) && this.slugOwner.get(base) !== file; n++) base = `${slugify(file)}-${n}`;
      this.slugOwner.set(base, file);
      job = { slug: hue ? `${base}--hue${hue}` : base, source: { file, ...dims }, hue };
      this.jobs.set(jobKey, job);
    }
    return { slug: job.slug, columns: Math.max(1, Math.floor(dims.width / ANIM_CELL_SIZE)) };
  }

  all(): SheetJob[] {
    return [...this.jobs.values()];
  }
}

function convertCell(raw: RubyValue): MoveAnimationCell | null {
  if (!Array.isArray(raw)) return null;
  const pattern = num(raw[RAW.PATTERN], -1);
  if (pattern < 0 || num(raw[RAW.VISIBLE], 1) === 0) return null;
  const alpha = Math.max(0, Math.min(255, Math.round(num(raw[RAW.COLOR_A]))));
  const color =
    alpha === 0
      ? 0
      : ((alpha << 24) |
          (Math.round(num(raw[RAW.COLOR_R])) << 16) |
          (Math.round(num(raw[RAW.COLOR_G])) << 8) |
          Math.round(num(raw[RAW.COLOR_B]))) >>>
        0;
  const priority = Math.max(0, Math.min(3, num(raw[RAW.PRIORITY], 1)));
  const focus = Math.max(1, Math.min(4, num(raw[RAW.FOCUS], 3)));
  return [
    num(raw[RAW.X]),
    num(raw[RAW.Y]),
    num(raw[RAW.ZOOM_X], 100),
    num(raw[RAW.ZOOM_Y], 100),
    num(raw[RAW.ANGLE]),
    num(raw[RAW.MIRROR]) ? 1 : 0,
    num(raw[RAW.BLEND]) === 1 ? 1 : num(raw[RAW.BLEND]) === 2 ? 2 : 0,
    pattern,
    Math.max(0, Math.min(255, num(raw[RAW.OPACITY], 255))),
    priority as 0 | 1 | 2 | 3,
    focus as 1 | 2 | 3 | 4,
    color,
  ];
}

function findBattlerCell(frame: RubyValue[] | null, pattern: number): RubyValue[] | null {
  if (!frame) return null;
  for (const cell of frame) {
    if (Array.isArray(cell) && num(cell[RAW.PATTERN], 0) === pattern) return cell;
  }
  return null;
}

function convertBattlerCell(raw: RubyValue[] | null, anchorX: number, anchorY: number): MoveAnimationBattlerCell | null {
  if (!raw) return null;
  return [
    num(raw[RAW.X]) - anchorX,
    num(raw[RAW.Y]) - anchorY,
    Math.max(0, Math.min(255, num(raw[RAW.OPACITY], 255))),
    num(raw[RAW.VISIBLE], 1) ? 1 : 0,
  ];
}

function convertTiming(timing: RubyObject[]): MoveAnimationSfxCue[] {
  const cues: MoveAnimationSfxCue[] = [];
  for (const entry of timing) {
    if (num(entry.ivars.timingType) !== 0) continue; // 1-4 are screen backgrounds/flashes, not shipped
    const clip = str(entry.ivars.name);
    if (!clip) continue;
    cues.push([num(entry.ivars.frame), clip, num(entry.ivars.volume, 100), num(entry.ivars.pitch, 100)]);
  }
  return cues;
}

/** True when the animation itself carries the user into the target — a
 * Tackle-style dash, as opposed to a beam or a jump the attacker fires from
 * where it stands. Measured along the canonical user->target line. */
function dashesIntoTarget(frames: MoveAnimationFrame[]): boolean {
  const axisX = ANIM_TARGET_X - ANIM_USER_X;
  const axisY = ANIM_TARGET_Y - ANIM_USER_Y;
  const axisLength = Math.hypot(axisX, axisY);
  for (const frame of frames) {
    if (!frame.u) continue;
    const along = (frame.u[0] * axisX + frame.u[1] * axisY) / axisLength;
    if (along > MELEE_DASH_THRESHOLD_PX) return true;
  }
  return false;
}

/** See MoveAnimationIndexEntry.screen. A cell-less self-targeting move
 * (Agility: a hop plus a speed-lines background) keeps the pack's battler
 * motion, since the arena's family VFX draw nothing for self moves. */
function isScreenWide(animation: PackAnimation, frames: MoveAnimationFrame[], selfTargeting: boolean): boolean {
  let total = 0;
  let screen = 0;
  for (const frame of frames) {
    for (const cell of frame.c) {
      total += 1;
      if (cell[10] === 4) screen += 1;
    }
  }
  if (total === 0) return animation.hasScreenOverlay && !selfTargeting;
  return screen / total >= SCREEN_FOCUS_FRACTION;
}

async function convertAnimation(
  animation: PackAnimation,
  sheets: SheetRegistry,
  warn: (message: string) => void,
  selfTargeting = false
): Promise<{ data: MoveAnimationData; melee: boolean; screen: boolean }> {
  const firstFrame = animation.frames.find((frame) => frame !== null) ?? null;
  const userAnchor = findBattlerCell(firstFrame, PATTERN_USER);
  const targetAnchor = findBattlerCell(firstFrame, PATTERN_TARGET);
  const userX = userAnchor ? num(userAnchor[RAW.X], ANIM_USER_X) : ANIM_USER_X;
  const userY = userAnchor ? num(userAnchor[RAW.Y], ANIM_USER_Y) : ANIM_USER_Y;
  const targetX = targetAnchor ? num(targetAnchor[RAW.X], ANIM_TARGET_X) : ANIM_TARGET_X;
  const targetY = targetAnchor ? num(targetAnchor[RAW.Y], ANIM_TARGET_Y) : ANIM_TARGET_Y;

  const frames: MoveAnimationFrame[] = animation.frames.map((frame) => {
    const cells: MoveAnimationCell[] = [];
    if (frame) {
      for (const raw of frame) {
        const cell = convertCell(raw);
        if (cell) cells.push(cell);
      }
    }
    return {
      u: convertBattlerCell(findBattlerCell(frame, PATTERN_USER), userX, userY),
      t: convertBattlerCell(findBattlerCell(frame, PATTERN_TARGET), targetX, targetY),
      c: cells,
    };
  });

  const usesSheet = frames.some((frame) => frame.c.length > 0);
  let sheet: string | null = null;
  let columns = 1;
  if (usesSheet && animation.graphic) {
    const resolved = await sheets.resolve(animation.graphic, animation.hue);
    if (resolved) {
      sheet = resolved.slug;
      columns = resolved.columns;
    } else {
      warn(`${animation.name}: sheet "${animation.graphic}" not found in Graphics/Animations — drawing battler motion only`);
      for (const frame of frames) frame.c = [];
    }
  }

  return {
    data: { v: 1, name: animation.name, sheet, columns, position: animation.position, frames, sfx: convertTiming(animation.timing) },
    melee: dashesIntoTarget(frames),
    screen: isScreenWide(animation, frames, selfTargeting),
  };
}

async function loadReachableMoveIds(): Promise<Set<number>> {
  const species = JSON.parse(await readFile(POKEMON_JSON_PATH, 'utf-8')) as GeneratedSpecies[];
  const pmdIds = new Set(JSON.parse(await readFile(PMD_SPRITE_IDS_PATH, 'utf-8')) as number[]);
  const reachable = new Set<number>();
  for (const entry of species) {
    if (!pmdIds.has(entry.id)) continue;
    for (const learned of entry.levelUpMoves) reachable.add(learned.moveId);
    for (const id of entry.tmMoves) reachable.add(id);
  }
  return reachable;
}

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

async function writeSheets(jobs: SheetJob[], force: boolean): Promise<void> {
  await mkdir(SHEETS_OUTPUT_DIR, { recursive: true });
  let encoded = 0;
  let skipped = 0;
  let fellBack = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;
  await mapWithConcurrency(
    jobs,
    async ({ slug, source, hue }) => {
      const sourcePath = join(SHEET_SOURCE_DIR, source.file);
      const outputPath = join(SHEETS_OUTPUT_DIR, `${slug}.png`);
      const [sourceTime, outputTime] = await Promise.all([mtimeMs(sourcePath), mtimeMs(outputPath)]);
      if (!force && outputTime !== null && sourceTime !== null && outputTime >= sourceTime) {
        skipped += 1;
      } else {
        // Sheets are pixel art whose cells the player crops by exact pixel
        // offsets, so nothing here may resample. A hue variant is the same
        // pixels with every color's hue rotated — what RGSS's
        // Bitmap#hue_change does at runtime in Essentials.
        const input = hue ? await sharp(sourcePath).ensureAlpha().modulate({ hue }).png().toBuffer() : sourcePath;
        const { png, lossless } = await optimizePng(input);
        await writeFile(outputPath, png);
        encoded += 1;
        if (lossless) fellBack += 1;
      }
      const [before, after] = await Promise.all([stat(sourcePath), stat(outputPath)]);
      bytesBefore += before.size;
      bytesAfter += after.size;
    },
    undefined,
    Math.max(2, Math.min(4, cpus().length - 1))
  );
  console.log(
    `[build-move-animations] sheets: encoded ${encoded} (${fellBack} lossless fallbacks), up to date ${skipped}, ` +
      `${(bytesBefore / 1048576).toFixed(1)} MB -> ${(bytesAfter / 1048576).toFixed(1)} MB`
  );
}

async function removeStaleFiles(dir: string, keep: Set<string>, pattern: RegExp): Promise<number> {
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!pattern.test(entry) || keep.has(entry)) continue;
    await rm(join(dir, entry));
    removed += 1;
  }
  return removed;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const startedAt = Date.now();

  let packBytes: Buffer;
  try {
    packBytes = await readFile(RXDATA_PATH);
  } catch {
    console.error(`[build-move-animations] no animation pack at ${RXDATA_PATH} (set MOVE_ANIM_PACK_DIR to point at it)`);
    process.exitCode = 1;
    return;
  }
  const pack = readPack(new Uint8Array(packBytes));
  const byName = new Map<string, PackAnimation>();
  for (const animation of pack) if (animation.name && !byName.has(animation.name)) byName.set(animation.name, animation);
  console.log(`[build-move-animations] decoded ${pack.length} animations from the pack`);

  const moves = JSON.parse(await readFile(MOVES_JSON_PATH, 'utf-8')) as Record<string, MoveDefinition>;
  const reachable = await loadReachableMoveIds();
  const allMoves: MoveDefinition[] = [...Object.values(moves), STRUGGLE_MOVE];

  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };
  const sheets = new SheetRegistry(await indexSheetSources(), new Map());

  await mkdir(MOVES_OUTPUT_DIR, { recursive: true });
  await mkdir(COMMON_OUTPUT_DIR, { recursive: true });

  const index: MoveAnimationIndex = { moves: {}, common: {} };
  const unmatchedReachable: string[] = [];
  const unmatchedOther: string[] = [];
  const moveFiles = new Set<string>();
  for (const move of allMoves.sort((a, b) => a.id - b.id)) {
    const key = normalizeMoveName(move.name);
    const animation = byName.get(ANIMATION_NAME_ALIASES[key] ?? `Move:${key}`);
    if (!animation) {
      (reachable.has(move.id) || move.id === STRUGGLE_MOVE.id ? unmatchedReachable : unmatchedOther).push(`${move.id} ${move.name}`);
      continue;
    }
    const { data, melee, screen } = await convertAnimation(animation, sheets, warn, move.targeting === 'self');
    const file = `${move.id}.json`;
    await writeFile(join(MOVES_OUTPUT_DIR, file), JSON.stringify(data), 'utf-8');
    moveFiles.add(file);
    const entry: MoveAnimationIndexEntry = { anim: animation.name, sheet: data.sheet, frames: data.frames.length, melee, screen };
    index.moves[String(move.id)] = entry;
  }

  const commonFiles = new Set<string>();
  for (const name of COMMON_ANIMATIONS) {
    const animation = byName.get(`Common:${name}`);
    if (!animation) {
      warn(`Common:${name} is not in the pack`);
      continue;
    }
    const { data, melee, screen } = await convertAnimation(animation, sheets, warn);
    const file = `${name}.json`;
    await writeFile(join(COMMON_OUTPUT_DIR, file), JSON.stringify(data), 'utf-8');
    commonFiles.add(file);
    index.common[name] = { anim: animation.name, sheet: data.sheet, frames: data.frames.length, melee, screen };
  }

  const sheetJobs = sheets.all();
  await writeSheets(sheetJobs, force);

  const staleMoves = await removeStaleFiles(MOVES_OUTPUT_DIR, moveFiles, /\.json$/);
  const staleCommon = await removeStaleFiles(COMMON_OUTPUT_DIR, commonFiles, /\.json$/);
  const staleSheets = await removeStaleFiles(SHEETS_OUTPUT_DIR, new Set(sheetJobs.map((job) => `${job.slug}.png`)), /\.png$/);

  await writeFile(INDEX_PATH, JSON.stringify(index), 'utf-8');

  const hueVariants = sheetJobs.filter((job) => job.hue !== 0).length;
  const screenWide = Object.values(index.moves).filter((entry) => entry.screen).length;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[build-move-animations] ${Object.keys(index.moves).length}/${allMoves.length} moves matched ` +
      `(${unmatchedReachable.length} reachable unmatched, ${unmatchedOther.length} unreachable unmatched), ` +
      `${screenWide} screen-wide (arena plays its own family VFX for those), ` +
      `${Object.keys(index.common).length} common animations, ${sheetJobs.length} sheets (${hueVariants} hue variants), ` +
      `removed ${staleMoves + staleCommon + staleSheets} stale files, in ${seconds}s`
  );
  for (const message of warnings) console.warn(`[build-move-animations] ${message}`);
  if (unmatchedOther.length) console.log(`[build-move-animations] unreachable moves without an animation: ${unmatchedOther.join('; ')}`);
  if (unmatchedReachable.length) {
    console.error(`[build-move-animations] REACHABLE moves without an animation: ${unmatchedReachable.join('; ')}`);
    process.exitCode = 1;
  }
  console.log(`[build-move-animations] wrote ${OUTPUT_ROOT} and ${INDEX_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
