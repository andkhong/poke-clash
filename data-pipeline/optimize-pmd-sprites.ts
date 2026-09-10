import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mapWithConcurrency } from './pokeapi';
import { optimizePng } from './pngOptimize';

// Turns the PMDCollab sprite mirror (pmd-sprite-mirror/<dir>/*.png, gitignored,
// ~224 MB — see fetch-pmd-sprites.ts) into the tree that gets uploaded to
// the production volume as /data/pmd-sprite-mirror
// (deploy-assets/pmd-sprite-mirror/, also gitignored): same folder/file
// layout so sprite-server needs no change, but
//
// - only the *-Anim.png sheets are kept. The client never requests the
//   *-Shadow.png companions (PokemonSprite.ts draws its own shadow), and
//   they're half the files in the mirror.
// - each sheet is re-encoded as a palette PNG (see pngOptimize.ts, shared
//   with build-move-animations.ts). The mirror stores every sheet as 8-bit
//   RGBA even though a PMD sprite uses a dozen or so colors, so an indexed
//   encoding is ~45% of the size; sheets the quantizer can't reproduce
//   exactly are written losslessly instead and counted.
//
// Re-running only re-encodes sheets whose source is newer than the existing
// output (or all of them with --force).
const SOURCE_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;
const OUTPUT_ROOT = new URL('../deploy-assets/pmd-sprite-mirror/', import.meta.url).pathname;
const SHEET_RE = /^[A-Za-z]+-Anim\.png$/;
/** libvips runs its own thread pool per operation, so a handful of
 * concurrent sheets already saturates the machine. */
const CONCURRENCY = 4;

async function mtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

interface Job {
  dir: string;
  file: string;
}

async function listJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  let dirs: string[];
  try {
    dirs = (await readdir(SOURCE_ROOT, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.error(`[optimize-pmd-sprites] no pmd-sprite-mirror/ at ${SOURCE_ROOT}`);
    return [];
  }
  for (const dir of dirs.sort()) {
    const files = (await readdir(join(SOURCE_ROOT, dir))).filter((f) => SHEET_RE.test(f)).sort();
    for (const file of files) jobs.push({ dir, file });
  }
  return jobs;
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const startedAt = Date.now();
  const jobs = await listJobs();
  console.log(`[optimize-pmd-sprites] ${jobs.length} sheets in ${new Set(jobs.map((j) => j.dir)).size} folders`);

  let encoded = 0;
  let skipped = 0;
  let failed = 0;
  let fellBack = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  await mapWithConcurrency(
    jobs,
    async ({ dir, file }) => {
      const source = join(SOURCE_ROOT, dir, file);
      const output = join(OUTPUT_ROOT, dir, file);
      const [sourceTime, outputTime] = await Promise.all([mtimeMs(source), mtimeMs(output)]);
      if (!force && outputTime !== null && sourceTime !== null && outputTime >= sourceTime) {
        skipped += 1;
      } else {
        try {
          const { png, lossless } = await optimizePng(source);
          await mkdir(join(OUTPUT_ROOT, dir), { recursive: true });
          await writeFile(output, png);
          encoded += 1;
          if (lossless) fellBack += 1;
        } catch (err) {
          failed += 1;
          console.warn(`[optimize-pmd-sprites] ${dir}/${file}: ${(err as Error).message}`);
          return;
        }
      }
      const [before, after] = await Promise.all([stat(source), stat(output)]);
      bytesBefore += before.size;
      bytesAfter += after.size;
    },
    (done, total) => {
      if (done % 2000 === 0 || done === total) console.log(`[optimize-pmd-sprites] ${done}/${total}`);
    },
    CONCURRENCY
  );

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(
    `[optimize-pmd-sprites] encoded ${encoded} (${fellBack} lossless fallbacks), up to date ${skipped}, failed ${failed} in ${seconds}s`
  );
  console.log(
    `[optimize-pmd-sprites] ${(bytesBefore / 1048576).toFixed(0)} MB -> ${(bytesAfter / 1048576).toFixed(0)} MB (${((100 * bytesAfter) / Math.max(1, bytesBefore)).toFixed(0)}%) for the sheets the client uses; Shadow sheets dropped`
  );
  console.log(`[optimize-pmd-sprites] wrote ${OUTPUT_ROOT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
