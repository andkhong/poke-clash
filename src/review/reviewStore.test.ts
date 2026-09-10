import { describe, expect, it } from 'vitest';
import { buildMoveCatalog, resolveAnimationSource } from './moveCatalog';
import {
  countMarked,
  isMarked,
  loadMarks,
  marksToMarkdown,
  parseMarks,
  saveMarks,
  serializeMarks,
  setMark,
  type ReviewMarks,
} from './reviewStore';
import { STRUGGLE_MOVE, STRUGGLE_MOVE_ID } from '../sim/struggle';

const NOW = new Date('2026-09-10T12:00:00.000Z');

describe('moveCatalog', () => {
  const catalog = buildMoveCatalog();

  it('lists every dataset move plus Struggle, sorted by name', () => {
    expect(catalog.length).toBeGreaterThan(500);
    expect(catalog.some((entry) => entry.move.id === STRUGGLE_MOVE_ID)).toBe(true);
    const names = catalog.map((entry) => entry.move.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it('routes a move the same way the arena does', () => {
    const thunderbolt = catalog.find((entry) => entry.move.id === 85)!;
    expect(thunderbolt.source.kind).toBe('pack'); // has a non-screen pack animation
    const surf = catalog.find((entry) => entry.move.id === 57)!;
    expect(surf.source).toMatchObject({ kind: 'family', family: 'wave', reason: 'screen-wide' });
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

  it('round-trips through the export format and tolerates junk on import', () => {
    let marks: ReviewMarks = {};
    marks = setMark(marks, 87, { change: true, note: 'keep the arena bolt' }, NOW);
    marks = setMark(marks, 57, { change: true }, NOW);
    const json = serializeMarks(marks, NOW);
    const parsed = JSON.parse(json) as { version: number; marks: ReviewMarks };
    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.marks)).toEqual(['57', '87']); // sorted by id
    expect(parseMarks(json)).toEqual(marks);

    // A bare marks object is accepted too; bad keys/values are skipped.
    expect(parseMarks('{"85":{"change":true},"nope":{"change":true},"86":"x","88":{"change":false,"note":""}}')).toEqual({
      '85': { change: true, note: '', updatedAt: '' },
    });
    expect(() => parseMarks('[1,2]')).toThrow();
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

  it('renders the marked moves as a Markdown table sorted by name', () => {
    const catalog = buildMoveCatalog();
    let marks: ReviewMarks = {};
    marks = setMark(marks, 87, { change: true, note: 'too | busy\nsecond line' }, NOW); // Thunder
    marks = setMark(marks, 57, { note: 'fine as is?' }, NOW); // Surf
    const markdown = marksToMarkdown(marks, catalog, NOW);
    const lines = markdown.split('\n');
    expect(lines[0]).toBe('# Move VFX review — 2 marked (2026-09-10)');
    expect(lines[2]).toBe('| # | Move | Type | Category | Animation today | Change? | Note |');
    expect(lines[4]).toBe('| 57 | Surf | water | special | arena wave |  | fine as is? |');
    expect(lines[5]).toBe('| 87 | Thunder | electric | special | pack Move:THUNDER | yes | too \\| busy second line |');
  });
});
