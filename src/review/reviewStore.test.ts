import { describe, expect, it } from 'vitest';
import { buildMoveCatalog, resolveAnimationSource } from './moveCatalog';
import {
  buildReviewExport,
  countMarked,
  isMarked,
  loadMarks,
  markStatus,
  marksToMarkdown,
  normalizeChanges,
  normalizeMarks,
  parseMarks,
  reviewFileMarkdown,
  saveMarks,
  serializeMarks,
  setMark,
  statusCounts,
  type ReviewChanges,
  type ReviewMarks,
} from './reviewStore';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../sim/struggle';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const LATER = new Date('2026-09-10T13:00:00.000Z');

describe('moveCatalog', () => {
  const catalog = buildMoveCatalog();

  it('lists every dataset move plus Struggle, sorted by name', () => {
    expect(catalog.length).toBeGreaterThan(500);
    expect(catalog.some((entry) => entry.move.id === STRUGGLE_MOVE_ID)).toBe(true);
    const names = catalog.map((entry) => entry.move.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('routes a move the same way the arena does, review tuning included', () => {
    const tackle = catalog.find((entry) => entry.move.id === 33)!;
    expect(tackle.source).toMatchObject({ kind: 'pack', viaReview: false });
    expect(tackle.alternative).toBeNull();
    const thunderbolt = catalog.find((entry) => entry.move.id === 85)!;
    expect(thunderbolt.source).toMatchObject({ kind: 'family', family: 'thunder', reason: 'review-preference' }); // pinned by the review
    expect(thunderbolt.alternative).toMatchObject({ kind: 'pack', entry: { anim: 'Move:THUNDERBOLT' } });
    const surf = catalog.find((entry) => entry.move.id === 57)!;
    expect(surf.source).toMatchObject({ kind: 'family', family: 'wave', reason: 'screen-wide' });
    expect(surf.alternative).toMatchObject({ kind: 'pack', entry: { anim: 'Move:SURF' } });
    const petalBlizzard = catalog.find((entry) => entry.move.id === 572)!;
    expect(petalBlizzard.source).toMatchObject({ kind: 'pack', viaReview: true }); // a screen-wide animation the review chose
    expect(petalBlizzard.alternative).toMatchObject({ kind: 'family', family: 'rockBurst' });
    // The pack covers every move today, Struggle included (a battler-only
    // animation with no sheet), so 'no-pack-animation' is a reserve case.
    expect(resolveAnimationSource(STRUGGLE_MOVE)).toMatchObject({ kind: 'pack', entry: { sheet: null } });
    expect(catalog.filter((entry) => entry.source.kind === 'family' && entry.source.reason === 'no-pack-animation')).toEqual([]);
  });
});

describe('reviewStore', () => {
  it('adds, patches and drops marks without mutating the input', () => {
    const empty: ReviewMarks = {};
    const flagged = setMark(empty, 85, { change: true }, NOW);
    expect(empty).toEqual({});
    expect(flagged['85']).toEqual({ change: true, note: '', updatedAt: NOW.toISOString() });
    expect(isMarked(flagged['85'])).toBe(true);

    const noted = setMark(flagged, 85, { note: 'bolt too small' }, NOW);
    expect(noted['85']).toMatchObject({ change: true, note: 'bolt too small' });

    // Unflagging while a note remains keeps the mark; clearing both drops it.
    const unflagged = setMark(noted, 85, { change: false }, NOW);
    expect(unflagged['85']).toMatchObject({ change: false, note: 'bolt too small' });
    const cleared = setMark(unflagged, 85, { note: '   ' }, NOW);
    expect(cleared).toEqual({});
    expect(countMarked(noted)).toBe(1);
  });

  it('records, stamps and withdraws a verdict with feedback', () => {
    let marks = setMark({}, 85, { change: true }, NOW);
    marks = setMark(marks, 85, { verdict: 'changes-requested', feedback: 'still too low' }, LATER);
    expect(marks['85']).toMatchObject({ verdict: 'changes-requested', verdictAt: LATER.toISOString(), feedback: 'still too low' });
    marks = setMark(marks, 85, { verdict: undefined }, LATER);
    expect(marks['85'].verdict).toBeUndefined();
    expect(marks['85'].verdictAt).toBeUndefined();
    expect(marks['85'].feedback).toBe('still too low');
    marks = setMark(marks, 85, { feedback: '' }, LATER);
    expect(marks['85'].feedback).toBeUndefined();
    // A verdict alone keeps the mark alive even once the flag and note are gone.
    const judgedOnly = setMark(setMark({}, 33, { verdict: 'approved' }, NOW), 33, { change: false, note: '' }, NOW);
    expect(isMarked(judgedOnly['33'])).toBe(true);
    // So does an asset preference; withdrawing it drops the mark again.
    const preferred = setMark({}, 57, { prefer: 'pack' }, NOW);
    expect(preferred['57']).toMatchObject({ prefer: 'pack' });
    expect(setMark(preferred, 57, { prefer: undefined }, NOW)).toEqual({});
    expect(normalizeMarks({ '57': { prefer: 'pack' }, '58': { prefer: 'nope' } })).toEqual({ '57': { change: false, note: '', updatedAt: '', prefer: 'pack' } });
  });

  it('derives a status from the verdict and the change’s freshness', () => {
    const change = { summary: 'lifted', changedAt: LATER.toISOString() };
    expect(markStatus(undefined, undefined)).toBe('open');
    expect(markStatus({ change: true, note: '', updatedAt: '' }, undefined)).toBe('open');
    expect(markStatus({ change: true, note: '', updatedAt: '' }, change)).toBe('proposed');
    const approvedBefore = setMark({}, 85, { verdict: 'approved' }, NOW)['85'];
    expect(markStatus(approvedBefore, change)).toBe('proposed'); // change is newer than the verdict
    const approvedAfter = setMark({}, 85, { verdict: 'approved' }, new Date('2026-09-10T14:00:00.000Z'))['85'];
    expect(markStatus(approvedAfter, change)).toBe('approved');
    const rejected = setMark({}, 85, { verdict: 'changes-requested' }, new Date('2026-09-10T14:00:00.000Z'))['85'];
    expect(markStatus(rejected, change)).toBe('changes-requested');

    const marks: ReviewMarks = { '85': approvedAfter, '87': { change: true, note: 'x', updatedAt: '' }, '57': rejected };
    const changes: ReviewChanges = { '85': change, '57': change };
    expect(statusCounts(marks, changes)).toEqual({ open: 1, proposed: 0, approved: 1, 'changes-requested': 1 });
  });

  it('round-trips through the export format and tolerates junk on import', () => {
    let marks: ReviewMarks = {};
    marks = setMark(marks, 87, { change: true, note: 'keep the arena bolt' }, NOW);
    marks = setMark(marks, 57, { change: true }, NOW);
    marks = setMark(marks, 57, { verdict: 'approved', feedback: 'nice' }, LATER);
    const exported = buildReviewExport(marks, NOW);
    expect(exported.version).toBe(1);
    expect(Object.keys(exported.marks)).toEqual(['57', '87']); // sorted by id
    expect(JSON.parse(serializeMarks(marks, NOW))).toEqual(exported);
    expect(parseMarks(serializeMarks(marks, NOW))).toEqual(marks);
    expect(normalizeMarks(exported)).toEqual(marks);

    // A bare marks object is accepted too; bad keys/values are skipped.
    expect(
      parseMarks('{"85":{"change":true,"verdict":"maybe"},"nope":{"change":true},"86":"x","88":{"change":false,"note":""}}')
    ).toEqual({ '85': { change: true, note: '', updatedAt: '' } });
    expect(() => parseMarks('[1,2]')).toThrow();
    expect(() => normalizeMarks(null)).toThrow();
  });

  it('reads the changes file leniently', () => {
    expect(normalizeChanges({ '85': { summary: 'arena bolt', changedAt: 'x' }, '86': { summary: '' }, bad: { summary: 'y' } })).toEqual({
      '85': { summary: 'arena bolt', changedAt: 'x' },
    });
    expect(normalizeChanges({ changes: { '44': { summary: 'lifted' } } })).toEqual({ '44': { summary: 'lifted', changedAt: '' } });
    expect(() => normalizeChanges([])).toThrow();
  });

  it('loads and saves through a storage-like object, swallowing failures', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const marks = setMark({}, 85, { change: true }, NOW);
    saveMarks(storage, marks);
    expect(loadMarks(storage)).toEqual(marks);
    expect(loadMarks(null)).toEqual({});
    expect(loadMarks({ getItem: () => 'not json', setItem: () => {} })).toEqual({});
    expect(() =>
      saveMarks(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error('quota');
          },
        },
        marks
      )
    ).not.toThrow();
  });

  it('renders the marked moves as a Markdown table sorted by name, with status, change and feedback', () => {
    const catalog = buildMoveCatalog();
    let marks: ReviewMarks = {};
    marks = setMark(marks, 87, { change: true, note: 'too | busy\nsecond line' }, NOW); // Thunder
    marks = setMark(marks, 57, { note: 'fine as is?' }, NOW); // Surf
    marks = setMark(marks, 85, { change: true, note: 'old bolt' }, NOW); // Thunderbolt
    marks = setMark(marks, 85, { verdict: 'changes-requested', feedback: 'brighter' }, LATER);
    marks = setMark(marks, 57, { prefer: 'pack' }, NOW);
    const changes: ReviewChanges = { '85': { summary: 'plays the arena bolt', changedAt: NOW.toISOString() } };

    const markdown = marksToMarkdown(marks, catalog, { now: NOW, changes });
    const lines = markdown.split('\n');
    expect(lines[0]).toBe('# Move VFX review — 3 marked (2026-09-10)');
    expect(lines[2]).toBe('| # | Move | Type | Category | Animation today | Change? | Note | Status | Change made | Feedback | Assets |');
    expect(lines[4]).toBe('| 57 | Surf | water | special | arena wave |  | fine as is? | open |  |  | use the pack animation |');
    expect(lines[5]).toBe('| 87 | Thunder | electric | special | pack Move:THUNDER | yes | too \\| busy second line | open |  |  |  |');
    expect(lines[6]).toBe(
      '| 85 | Thunderbolt | electric | special | arena thunder | yes | old bolt | changes requested | plays the arena bolt | brighter |  |'
    );

    // The repo file carries a preamble (with the status tally) between the heading and the same table.
    const fileMarkdown = reviewFileMarkdown(marks, catalog, { now: NOW, changes });
    expect(fileMarkdown.startsWith(`${lines[0]}\n\nGenerated by the move-VFX review page`)).toBe(true);
    expect(fileMarkdown).toContain('vfx-review/marks.json');
    expect(fileMarkdown).toContain('vfx-review/changes.json');
    expect(fileMarkdown).toContain('Status: 2 open · 0 proposed (awaiting review) · 0 approved · 1 changes requested.');
    expect(fileMarkdown.endsWith(lines.slice(2).join('\n'))).toBe(true);
  });
});
