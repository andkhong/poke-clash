import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { PMD_SPRITE_INDEX_PATH, writePmdSpriteIndex } from './pmdSpriteIndexFiles';
import {
  latestUpstreamChange,
  paddedDex,
  planHasWork,
  planSpriteUpdates,
  renderChangelogEntry,
  renderPlanReport,
  type AppliedUpdate,
  type SpriteUpdatePlan,
  type Tracker,
} from './pmdSpriteUpdates';
import type { PmdSpriteIndex } from '../src/data/types';

// Keeps the PMD sprite mirror in step with PMDCollab/SpriteCollab.
//
//   npm run data:pmd-sprites:check            report what upstream has that we don't
//   npm run data:pmd-sprites:update           ...and fetch it, optimize, and bundle the volume upload
//   npm run data:pmd-sprites:check -- --json report.json   also write the plan as JSON (CI)
//
// The check downloads upstream's tracker.json and compares each species'
// `sprite_modified` with when our index fetched it (see pmdSpriteUpdates.ts),
// so a species whose sprites were missing when the mirror was built comes
// back automatically once upstream has them, and species upstream redrew
// get re-fetched. Every run records itself in pmd-sprite-updates.json; an
// applied update also lands in PMD_SPRITE_UPDATES.md. The fetch itself is
// the existing scripts (fetch-pmd-sprites.ts, fetch-pmd-shiny-sprites.ts,
// optimize-pmd-sprites.ts), run for just the affected species; what they
// produce for the volume is tarred up for scripts/upload-pmd-sprites.sh.
// measure-pmd-bodies.ts then re-measures the visible body sizes the arena
// scales sprites by (src/data/generated/pmdBodySizes.json, bundled with the
// app rather than uploaded), since a redrawn sheet may have a new silhouette.

const TRACKER_URL = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/tracker.json';
const TRACKER_COMMITS_URL = 'https://api.github.com/repos/PMDCollab/SpriteCollab/commits?path=tracker.json&per_page=1';
const POKEMON_JSON_PATH = new URL('../src/data/generated/pokemon.json', import.meta.url).pathname;
const STATE_PATH = new URL('./pmd-sprite-updates.json', import.meta.url).pathname;
const CHANGELOG_PATH = new URL('./PMD_SPRITE_UPDATES.md', import.meta.url).pathname;
const TRACKER_CACHE_PATH = new URL('./cache/tracker.json', import.meta.url).pathname;
const RAW_ZIP_CACHE_DIR = new URL('./cache/pmd-sprites-raw/', import.meta.url).pathname;
const RAW_SHINY_ZIP_CACHE_DIR = new URL('./cache/pmd-shiny-sprites-raw/', import.meta.url).pathname;
const DEPLOY_ASSETS_ROOT = new URL('../deploy-assets/', import.meta.url).pathname;
const FETCH_SCRIPT = new URL('./fetch-pmd-sprites.ts', import.meta.url).pathname;
const FETCH_SHINY_SCRIPT = new URL('./fetch-pmd-shiny-sprites.ts', import.meta.url).pathname;
const OPTIMIZE_SCRIPT = new URL('./optimize-pmd-sprites.ts', import.meta.url).pathname;
const MEASURE_BODIES_SCRIPT = new URL('./measure-pmd-bodies.ts', import.meta.url).pathname;
const CHANGELOG_HEADER = `# PMD sprite updates

Every applied run of \`npm run data:pmd-sprites:update\` (see
data-pipeline/check-pmd-sprite-updates.ts), newest first. Upstream is
PMDCollab/SpriteCollab; "added" species were missing from the mirror (and so
from the roster) until upstream drew them.

`;

interface UpdateState {
  version: 1;
  lastCheckedAt: string | null;
  upstream: {
    trackerCommit: string | null;
    trackerCommittedAt: string | null;
    latestSpriteChangeAt: string | null;
  };
  /** What the last check found still to do. */
  pending: {
    add: number[];
    update: number[];
    shinyAdd: number[];
    shinyUpdate: number[];
    missingUpstream: number;
  };
  history: AppliedUpdate[];
}

interface Options {
  apply: boolean;
  jsonPath: string | null;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { apply: false, jsonPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') options.apply = true;
    else if (argv[i] === '--json') options.jsonPath = argv[++i] ?? 'pmd-sprite-report.json';
    else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return options;
}

async function loadJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

async function downloadTracker(): Promise<Tracker> {
  console.log(`[pmd-sprite-updates] downloading ${TRACKER_URL}`);
  const res = await fetch(TRACKER_URL);
  if (!res.ok) throw new Error(`tracker.json: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(new URL('./cache/', import.meta.url).pathname, { recursive: true });
  await writeFile(TRACKER_CACHE_PATH, text, 'utf-8');
  return JSON.parse(text) as Tracker;
}

/** Best effort: the upstream commit that last touched tracker.json, for the
 * record. Unauthenticated GitHub API calls are rate-limited, so a failure
 * here is logged, not fatal. */
async function fetchTrackerCommit(): Promise<{ sha: string; at: string } | null> {
  try {
    const res = await fetch(TRACKER_COMMITS_URL, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const commits = (await res.json()) as { sha: string; commit: { committer: { date: string } } }[];
    const first = commits[0];
    return first ? { sha: first.sha.slice(0, 7), at: first.commit.committer.date } : null;
  } catch (err) {
    console.warn(`[pmd-sprite-updates] could not read the upstream commit: ${(err as Error).message}`);
    return null;
  }
}

function runScript(script: string, env: Record<string, string>): void {
  console.log(`[pmd-sprite-updates] running ${script.split('/').pop()} ${JSON.stringify(env)}`);
  execFileSync('npx', ['tsx', script], { stdio: 'inherit', env: { ...process.env, ...env } });
}

async function removeCachedZips(dir: string, ids: readonly number[]): Promise<void> {
  await Promise.all(ids.map((id) => rm(`${dir}${paddedDex(id)}.zip`, { force: true })));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Fetches what the plan asks for, re-optimizes, and bundles the affected
 * sprite folders for the volume. Returns what actually landed. */
async function applyPlan(plan: SpriteUpdatePlan, trackerCommit: string | null): Promise<AppliedUpdate> {
  const baseIds = [...plan.add, ...plan.update];
  // A species we're adding may have a shiny too; the shiny script only
  // looks at species already in the index, so it runs after the base fetch.
  const shinyIds = [...new Set([...plan.shinyAdd, ...plan.shinyUpdate, ...plan.add])];

  if (baseIds.length) {
    // The fetch scripts keep raw zips forever; drop the ones we're refreshing.
    await removeCachedZips(RAW_ZIP_CACHE_DIR, baseIds);
    runScript(FETCH_SCRIPT, { PMD_SPRITE_SPECIES_IDS: baseIds.join(','), PMD_SPRITE_FORCE: 'true' });
  }
  if (shinyIds.length) {
    await removeCachedZips(RAW_SHINY_ZIP_CACHE_DIR, shinyIds);
    runScript(FETCH_SHINY_SCRIPT, { PMD_SHINY_SPRITE_SPECIES_IDS: shinyIds.join(','), PMD_SHINY_SPRITE_FORCE: 'true' });
  }
  runScript(OPTIMIZE_SCRIPT, {});
  runScript(MEASURE_BODIES_SCRIPT, {});

  const index = await loadJsonOrDefault<PmdSpriteIndex>(PMD_SPRITE_INDEX_PATH, {});
  const landed = (id: number): boolean => !!index[String(id)];
  const failed = baseIds.filter((id) => !landed(id));
  const added = plan.add.filter(landed);
  const updated = plan.update.filter(landed);
  // A newly added species brings its shiny recolor along (see shinyIds above).
  const shinyAdded = [...new Set([...plan.shinyAdd, ...added])].filter((id) => !!index[String(id)]?.shiny);
  const shinyUpdated = plan.shinyUpdate.filter((id) => !!index[String(id)]?.shiny);

  // Bundle every affected folder that the optimizer produced, for
  // scripts/upload-pmd-sprites.sh — same layout the volume already has.
  const dirs: string[] = [];
  for (const id of [...added, ...updated]) dirs.push(`pmd-sprite-mirror/${index[String(id)].dir}`);
  for (const id of [...shinyAdded, ...shinyUpdated]) {
    const shinyDir = index[String(id)].shiny?.dir;
    if (shinyDir) dirs.push(`pmd-sprite-mirror/${shinyDir}`);
  }
  const present: string[] = [];
  for (const dir of [...new Set(dirs)]) if (await exists(`${DEPLOY_ASSETS_ROOT}${dir}`)) present.push(dir);

  let tarball: string | null = null;
  if (present.length) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    tarball = `deploy-assets/pmd-sprite-update-${stamp}.tar.gz`;
    execFileSync('tar', ['-C', DEPLOY_ASSETS_ROOT, '-czf', `${DEPLOY_ASSETS_ROOT}pmd-sprite-update-${stamp}.tar.gz`, ...present], { stdio: 'inherit' });
    console.log(`[pmd-sprite-updates] bundled ${present.length} folders into ${tarball}`);
  }

  return {
    at: new Date().toISOString(),
    trackerCommit,
    added,
    updated,
    shinyAdded,
    shinyUpdated,
    failed,
    stillMissingUpstream: plan.missingUpstream.length,
    tarball,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const species = await loadJsonOrDefault<{ id: number; name: string }[]>(POKEMON_JSON_PATH, []);
  if (species.length === 0) throw new Error(`no species in ${POKEMON_JSON_PATH} — run npm run data:build first`);
  const nameOf = new Map(species.map((s) => [s.id, s.name]));
  const name = (id: number): string => nameOf.get(id) ?? '?';

  const [tracker, commit] = await Promise.all([downloadTracker(), fetchTrackerCommit()]);
  let index = await loadJsonOrDefault<PmdSpriteIndex>(PMD_SPRITE_INDEX_PATH, {});

  // Older indexes predate the per-species cache tags (see pmdSpriteIndexFiles.ts);
  // rewriting once stamps them in without fetching anything.
  if (Object.values(index).some((entry) => !entry.version)) {
    console.log('[pmd-sprite-updates] stamping cache versions into the index');
    await writePmdSpriteIndex(index);
    index = await loadJsonOrDefault<PmdSpriteIndex>(PMD_SPRITE_INDEX_PATH, {});
  }

  const plan = planSpriteUpdates(
    species.map((s) => s.id),
    tracker,
    index
  );
  const latestChange = latestUpstreamChange(tracker);
  console.log(`\nUpstream tracker${commit ? ` at ${commit.sha} (${commit.at})` : ''}, newest sprite change ${latestChange ?? 'unknown'}\n`);
  console.log(renderPlanReport(plan, name));

  const state = await loadJsonOrDefault<UpdateState>(STATE_PATH, {
    version: 1,
    lastCheckedAt: null,
    upstream: { trackerCommit: null, trackerCommittedAt: null, latestSpriteChangeAt: null },
    pending: { add: [], update: [], shinyAdd: [], shinyUpdate: [], missingUpstream: 0 },
    history: [],
  });

  let applied: AppliedUpdate | null = null;
  if (options.apply && planHasWork(plan)) {
    applied = await applyPlan(plan, commit?.sha ?? null);
    const landed = applied.added.length + applied.updated.length + applied.shinyAdded.length + applied.shinyUpdated.length > 0;
    if (landed) {
      // A run that fetched nothing (the asset server was down) isn't an update; it's only reported below.
      state.history.unshift(applied);
      if (!(await exists(CHANGELOG_PATH))) await writeFile(CHANGELOG_PATH, CHANGELOG_HEADER, 'utf-8');
      // Newest first: insert after the header.
      const existing = await readFile(CHANGELOG_PATH, 'utf-8');
      const headerEnd = existing.indexOf('\n## ');
      const entry = renderChangelogEntry(applied, name);
      await writeFile(CHANGELOG_PATH, headerEnd < 0 ? `${existing}${entry}` : `${existing.slice(0, headerEnd + 1)}${entry}${existing.slice(headerEnd + 1)}`, 'utf-8');
    }
    // What's left after the apply: whatever the fetch couldn't get.
    const stillPending = planSpriteUpdates(
      species.map((s) => s.id),
      tracker,
      await loadJsonOrDefault<PmdSpriteIndex>(PMD_SPRITE_INDEX_PATH, {})
    );
    state.pending = { add: stillPending.add, update: stillPending.update, shinyAdd: stillPending.shinyAdd, shinyUpdate: stillPending.shinyUpdate, missingUpstream: stillPending.missingUpstream.length };
  } else {
    state.pending = { add: plan.add, update: plan.update, shinyAdd: plan.shinyAdd, shinyUpdate: plan.shinyUpdate, missingUpstream: plan.missingUpstream.length };
  }
  state.lastCheckedAt = new Date().toISOString();
  state.upstream = { trackerCommit: commit?.sha ?? state.upstream.trackerCommit, trackerCommittedAt: commit?.at ?? state.upstream.trackerCommittedAt, latestSpriteChangeAt: latestChange };
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

  if (options.jsonPath) {
    await writeFile(options.jsonPath, `${JSON.stringify({ checkedAt: state.lastCheckedAt, upstream: state.upstream, plan, applied, report: renderPlanReport(plan, name) }, null, 2)}\n`, 'utf-8');
    console.log(`[pmd-sprite-updates] wrote ${options.jsonPath}`);
  }

  if (applied) {
    console.log(`\n${renderChangelogEntry(applied, name)}`);
    console.log('Next steps:');
    if (applied.tarball) console.log(`  1. npm run deploy:pmd-sprites -- ${applied.tarball}   # puts the new sheets on the Fly volume`);
    console.log(`  ${applied.tarball ? '2' : '1'}. commit public/pmd-sprite-index.json, src/data/generated/, data-pipeline/pmd-sprite-updates.json and PMD_SPRITE_UPDATES.md, then deploy the app (git push deploys via GitHub Actions)`);
  } else if (planHasWork(plan)) {
    console.log('\nRun `npm run data:pmd-sprites:update` to fetch these.');
  } else {
    console.log('\nThe mirror is up to date with upstream.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
