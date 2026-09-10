import type { PmdSpriteIndex } from '../src/data/types';
import { REQUIRED_ACTIONS } from './pmdSpriteZip';

// Keeping the PMD sprite mirror in step with PMDCollab/SpriteCollab. The
// upstream repo publishes tracker.json, one node per species (keyed by the
// zero-padded dex number) with `sprite_files` (which actions exist) and
// `sprite_modified` (when its sprites last changed); forms nest under
// `subgroups`, and a species' shiny recolor is form 0000's subgroup 0001
// (the same "0000/0001" path fetch-pmd-shiny-sprites.ts downloads). This
// module is the pure part: read that state, compare it with our index, and
// say what to fetch. check-pmd-sprite-updates.ts does the fetching.

export interface TrackerNode {
  name?: string;
  sprite_complete?: number;
  sprite_modified?: string;
  sprite_files?: Record<string, boolean>;
  subgroups?: Record<string, TrackerNode>;
}

export type Tracker = Record<string, TrackerNode>;

export interface UpstreamSpriteState {
  name: string;
  /** The base form has every action the arena requires (Idle + Walk). */
  available: boolean;
  /** ISO time of the base form's last sprite change, null if it has none. */
  modifiedAt: string | null;
  shinyAvailable: boolean;
  shinyModifiedAt: string | null;
}

export const SHINY_SUBGROUP_PATH = ['0000', '0001'] as const;

export function paddedDex(id: number): string {
  return String(id).padStart(4, '0');
}

/** tracker.json timestamps look like "2021-11-20 20:44:46.758243" (UTC,
 * microseconds); returns ISO with millisecond precision, or null. */
export function parseTrackerTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(value);
  if (!match) return null;
  const millis = (match[3] ?? '').slice(0, 3).padEnd(3, '0');
  const date = new Date(`${match[1]}T${match[2]}.${millis}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hasRequiredActions(node: TrackerNode | undefined): boolean {
  const files = node?.sprite_files ?? {};
  return REQUIRED_ACTIONS.every((action) => files[action] === true);
}

export function upstreamSpriteState(tracker: Tracker, id: number): UpstreamSpriteState | null {
  const node = tracker[paddedDex(id)];
  if (!node) return null;
  const shiny = node.subgroups?.[SHINY_SUBGROUP_PATH[0]]?.subgroups?.[SHINY_SUBGROUP_PATH[1]];
  return {
    name: node.name ?? '',
    available: hasRequiredActions(node),
    modifiedAt: parseTrackerTimestamp(node.sprite_modified),
    shinyAvailable: hasRequiredActions(shiny),
    shinyModifiedAt: parseTrackerTimestamp(shiny?.sprite_modified),
  };
}

export interface SpriteUpdatePlan {
  /** Species with upstream sprites that the mirror doesn't have yet — the
   * ones currently left out of the roster and due to come back. */
  add: number[];
  /** Mirrored species whose upstream sprites changed since we fetched them. */
  update: number[];
  /** Mirrored (or about-to-be-added) species with a shiny recolor upstream
   * that the mirror doesn't have. */
  shinyAdd: number[];
  /** Species whose shiny recolor changed upstream since we fetched it. */
  shinyUpdate: number[];
  /** Species upstream still has no usable sprites for. */
  missingUpstream: number[];
  /** Species the tracker doesn't list at all (newer than the upstream repo). */
  notInTracker: number[];
  /** Mirrored species with nothing new upstream. */
  unchanged: number[];
}

function isNewer(upstream: string | null, ours: string | undefined): boolean {
  if (!upstream) return false;
  if (!ours) return true;
  return Date.parse(upstream) > Date.parse(ours);
}

/** Compares upstream's state for every species we know with what the mirror
 * holds (the committed index: generatedAt is when a species was fetched). */
export function planSpriteUpdates(speciesIds: readonly number[], tracker: Tracker, index: PmdSpriteIndex): SpriteUpdatePlan {
  const plan: SpriteUpdatePlan = { add: [], update: [], shinyAdd: [], shinyUpdate: [], missingUpstream: [], notInTracker: [], unchanged: [] };
  for (const id of speciesIds) {
    const upstream = upstreamSpriteState(tracker, id);
    if (!upstream) {
      plan.notInTracker.push(id);
      continue;
    }
    const entry = index[String(id)];
    let willBeMirrored = !!entry;
    if (!entry) {
      if (upstream.available) {
        plan.add.push(id);
        willBeMirrored = true;
      } else {
        plan.missingUpstream.push(id);
      }
    } else if (isNewer(upstream.modifiedAt, entry.generatedAt)) {
      plan.update.push(id);
    } else {
      plan.unchanged.push(id);
    }
    if (willBeMirrored && upstream.shinyAvailable) {
      if (!entry?.shiny) plan.shinyAdd.push(id);
      else if (isNewer(upstream.shinyModifiedAt, entry.shiny.generatedAt ?? entry.generatedAt)) plan.shinyUpdate.push(id);
    }
  }
  return plan;
}

export function planHasWork(plan: SpriteUpdatePlan): boolean {
  return plan.add.length + plan.update.length + plan.shinyAdd.length + plan.shinyUpdate.length > 0;
}

/** The newest sprite change anywhere upstream — a quick "did anything
 * happen since last time" figure for the state file. */
export function latestUpstreamChange(tracker: Tracker): string | null {
  let latest: string | null = null;
  for (const node of Object.values(tracker)) {
    const at = parseTrackerTimestamp(node.sprite_modified);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

export type SpeciesName = (id: number) => string;

function listSpecies(ids: readonly number[], name: SpeciesName, limit = 40): string {
  const shown = ids.slice(0, limit).map((id) => `${id} ${name(id)}`);
  const more = ids.length > limit ? `, … ${ids.length - limit} more` : '';
  return shown.join(', ') + more;
}

export function renderPlanReport(plan: SpriteUpdatePlan, name: SpeciesName): string {
  const lines = [
    `Mirrored and current: ${plan.unchanged.length}`,
    `New upstream sprites to add (species coming back): ${plan.add.length}${plan.add.length ? ` — ${listSpecies(plan.add, name)}` : ''}`,
    `Changed upstream since fetched (to re-fetch): ${plan.update.length}${plan.update.length ? ` — ${listSpecies(plan.update, name)}` : ''}`,
    `Shiny recolors to add: ${plan.shinyAdd.length}${plan.shinyAdd.length ? ` — ${listSpecies(plan.shinyAdd, name)}` : ''}`,
    `Shiny recolors changed upstream: ${plan.shinyUpdate.length}${plan.shinyUpdate.length ? ` — ${listSpecies(plan.shinyUpdate, name)}` : ''}`,
    `Still missing upstream: ${plan.missingUpstream.length}${plan.missingUpstream.length ? ` — ${listSpecies(plan.missingUpstream, name, 80)}` : ''}`,
  ];
  if (plan.notInTracker.length) lines.push(`Not in upstream tracker: ${plan.notInTracker.length} — ${listSpecies(plan.notInTracker, name)}`);
  return lines.join('\n');
}

export interface AppliedUpdate {
  at: string;
  trackerCommit: string | null;
  added: number[];
  updated: number[];
  shinyAdded: number[];
  shinyUpdated: number[];
  /** Species the fetch still couldn't get (asset server error). */
  failed: number[];
  stillMissingUpstream: number;
  tarball: string | null;
}

export function renderChangelogEntry(update: AppliedUpdate, name: SpeciesName): string {
  const date = update.at.slice(0, 10);
  const parts = [
    `${update.added.length} added`,
    `${update.updated.length} updated`,
    `${update.shinyAdded.length + update.shinyUpdated.length} shiny`,
  ];
  const lines = [`## ${date} — ${parts.join(', ')}${update.trackerCommit ? ` (upstream tracker ${update.trackerCommit})` : ''}`, ''];
  if (update.added.length) lines.push(`- Added (back in the roster): ${listSpecies(update.added, name, 200)}`);
  if (update.updated.length) lines.push(`- Updated: ${listSpecies(update.updated, name, 200)}`);
  if (update.shinyAdded.length) lines.push(`- Shiny added: ${listSpecies(update.shinyAdded, name, 200)}`);
  if (update.shinyUpdated.length) lines.push(`- Shiny updated: ${listSpecies(update.shinyUpdated, name, 200)}`);
  if (update.failed.length) lines.push(`- Could not fetch (retry later): ${listSpecies(update.failed, name, 200)}`);
  lines.push(`- Still missing upstream: ${update.stillMissingUpstream}`);
  if (update.tarball) lines.push(`- Volume upload: \`${update.tarball}\``);
  lines.push('');
  return lines.join('\n');
}
