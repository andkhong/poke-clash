import { describe, expect, it } from 'vitest';
import type { PmdSpriteIndex } from '../src/data/types';
import {
  latestUpstreamChange,
  parseTrackerTimestamp,
  planSpriteUpdates,
  renderChangelogEntry,
  renderPlanReport,
  upstreamSpriteState,
  type Tracker,
} from './pmdSpriteUpdates';

const actions = { Idle: { frameWidth: 1, frameHeight: 1, directions: 8 as const, durationsMs: [1], hasShadow: false } };
const withWalk = { ...actions, Walk: actions.Idle };

const tracker: Tracker = {
  '0001': {
    name: 'Bulbasaur',
    sprite_files: { Idle: true, Walk: true },
    sprite_modified: '2024-03-05 19:04:44.331265',
    subgroups: { '0000': { subgroups: { '0001': { name: 'Shiny', sprite_files: { Idle: true, Walk: true }, sprite_modified: '2024-03-05 19:04:44.331265' } } } },
  },
  '0002': { name: 'Ivysaur', sprite_files: { Idle: true, Walk: true }, sprite_modified: '2021-01-01 00:00:00.000000' },
  '0003': { name: 'Venusaur', sprite_files: { Idle: true }, sprite_modified: '2021-01-01 00:00:00.000000' }, // no Walk yet
  '0004': { name: 'Charmander', sprite_files: { Idle: true, Walk: true }, sprite_modified: '2026-09-06 10:00:00.000000' },
  '0005': { name: 'Charmeleon', sprite_files: {}, sprite_modified: '' },
};

const index: PmdSpriteIndex = {
  '1': { dir: '0001', actions: withWalk, generatedAt: '2025-06-01T00:00:00.000Z' }, // current, shiny missing locally
  '4': { dir: '0004', actions: withWalk, generatedAt: '2025-06-01T00:00:00.000Z' }, // upstream changed since
  '5': { dir: '0005', actions: withWalk, generatedAt: '2025-06-01T00:00:00.000Z' }, // mirrored although upstream lists nothing
};

const name = (id: number): string => tracker[String(id).padStart(4, '0')]?.name ?? '?';

describe('parseTrackerTimestamp', () => {
  it('reads the tracker’s UTC timestamps at millisecond precision', () => {
    expect(parseTrackerTimestamp('2021-11-20 20:44:46.758243')).toBe('2021-11-20T20:44:46.758Z');
    expect(parseTrackerTimestamp('2021-11-20 20:44:46')).toBe('2021-11-20T20:44:46.000Z');
    expect(parseTrackerTimestamp('')).toBeNull();
    expect(parseTrackerTimestamp(undefined)).toBeNull();
    expect(parseTrackerTimestamp('garbage')).toBeNull();
  });
});

describe('upstreamSpriteState', () => {
  it('reads availability from the required actions and the shiny from form 0000/0001', () => {
    expect(upstreamSpriteState(tracker, 1)).toEqual({
      name: 'Bulbasaur',
      available: true,
      modifiedAt: '2024-03-05T19:04:44.331Z',
      shinyAvailable: true,
      shinyModifiedAt: '2024-03-05T19:04:44.331Z',
    });
    expect(upstreamSpriteState(tracker, 3)).toMatchObject({ available: false, shinyAvailable: false });
    expect(upstreamSpriteState(tracker, 5)).toMatchObject({ available: false, modifiedAt: null });
    expect(upstreamSpriteState(tracker, 999)).toBeNull();
  });
});

describe('planSpriteUpdates', () => {
  const plan = planSpriteUpdates([1, 2, 3, 4, 5, 6], tracker, index);

  it('sorts every species into exactly one bucket', () => {
    expect(plan.add).toEqual([2]); // upstream has it, mirror doesn't
    expect(plan.update).toEqual([4]); // changed after we fetched
    expect(plan.unchanged).toEqual([1, 5]); // 5 stays: we have it even though upstream lists nothing now
    expect(plan.missingUpstream).toEqual([3]); // Idle without Walk doesn't count
    expect(plan.notInTracker).toEqual([6]);
  });

  it('tracks shiny recolors for mirrored species only', () => {
    expect(plan.shinyAdd).toEqual([1]);
    expect(plan.shinyUpdate).toEqual([]);
    const withShiny: PmdSpriteIndex = { '1': { ...index['1'], shiny: { dir: '0001-shiny', actions: withWalk, generatedAt: '2023-01-01T00:00:00.000Z' } } };
    expect(planSpriteUpdates([1], tracker, withShiny).shinyUpdate).toEqual([1]);
    // Without its own timestamp the shiny is assumed as old as the base fetch.
    const legacyShiny: PmdSpriteIndex = { '1': { ...index['1'], shiny: { dir: '0001-shiny', actions: withWalk } } };
    expect(planSpriteUpdates([1], tracker, legacyShiny).shinyUpdate).toEqual([]);
  });

  it('renders a readable report and changelog', () => {
    const report = renderPlanReport(plan, name);
    expect(report).toContain('New upstream sprites to add (species coming back): 1 — 2 Ivysaur');
    expect(report).toContain('Changed upstream since fetched (to re-fetch): 1 — 4 Charmander');
    expect(report).toContain('Still missing upstream: 1 — 3 Venusaur');
    const entry = renderChangelogEntry(
      { at: '2026-09-10T18:00:00.000Z', trackerCommit: 'aab3d49', added: [2], updated: [4], shinyAdded: [1], shinyUpdated: [], failed: [], stillMissingUpstream: 1, tarball: 'deploy-assets/x.tar.gz' },
      name
    );
    expect(entry.split('\n')[0]).toBe('## 2026-09-10 — 1 added, 1 updated, 1 shiny (upstream tracker aab3d49)');
    expect(entry).toContain('- Added (back in the roster): 2 Ivysaur');
    expect(entry).toContain('- Volume upload: `deploy-assets/x.tar.gz`');
  });

  it('finds the newest upstream change', () => {
    expect(latestUpstreamChange(tracker)).toBe('2026-09-06T10:00:00.000Z');
  });
});
