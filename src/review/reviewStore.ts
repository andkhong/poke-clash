import { describeSource, type ReviewMove } from './moveCatalog';

// The review page's marks — which moves' VFX the reviewer wants changed, and
// why — kept in the browser's localStorage and exportable as JSON (to
// re-import elsewhere) or Markdown (to paste into a conversation or an
// issue). Pure functions over a plain object so they're testable without a
// DOM; the page passes in window.localStorage.

export interface MoveMark {
  /** Flagged as "change this VFX". */
  change: boolean;
  note: string;
  /** ISO timestamp of the last edit. */
  updatedAt: string;
}

/** Keyed by move id (as a string, since it's JSON). */
export type ReviewMarks = Record<string, MoveMark>;

export const REVIEW_STORAGE_KEY = 'poke-clash.vfx-review.v1';

interface ReviewExport {
  version: 1;
  exportedAt: string;
  marks: ReviewMarks;
}

/** A mark worth keeping: flagged, or carrying a note. An unflagged, empty
 * mark is dropped rather than stored. */
export function isMarked(mark: MoveMark | undefined): boolean {
  return !!mark && (mark.change || mark.note.trim().length > 0);
}

export function countMarked(marks: ReviewMarks): number {
  return Object.values(marks).filter(isMarked).length;
}

/** Returns a new marks object with the move's mark patched (never mutates);
 * a mark that ends up unflagged with no note is removed. */
export function setMark(
  marks: ReviewMarks,
  moveId: number,
  patch: Partial<Pick<MoveMark, 'change' | 'note'>>,
  now: Date = new Date()
): ReviewMarks {
  const key = String(moveId);
  const previous = marks[key] ?? { change: false, note: '', updatedAt: '' };
  const next: MoveMark = { ...previous, ...patch, updatedAt: now.toISOString() };
  const result = { ...marks };
  if (isMarked(next)) result[key] = next;
  else delete result[key];
  return result;
}

export function serializeMarks(marks: ReviewMarks, now: Date = new Date()): string {
  const ordered = Object.fromEntries(
    Object.entries(marks)
      .filter(([, mark]) => isMarked(mark))
      .sort(([a], [b]) => Number(a) - Number(b))
  );
  const payload: ReviewExport = { version: 1, exportedAt: now.toISOString(), marks: ordered };
  return JSON.stringify(payload, null, 2);
}

/** Accepts either a full export (`{ version, exportedAt, marks }`) or a bare
 * marks object; anything malformed inside is skipped rather than thrown. */
export function parseMarks(json: string): ReviewMarks {
  const raw: unknown = JSON.parse(json);
  const marks = raw && typeof raw === 'object' && 'marks' in raw ? (raw as { marks: unknown }).marks : raw;
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
    throw new Error('Not a review export: expected an object of marks keyed by move id');
  }
  const result: ReviewMarks = {};
  for (const [key, value] of Object.entries(marks as Record<string, unknown>)) {
    if (!/^-?\d+$/.test(key) || !value || typeof value !== 'object') continue;
    const candidate = value as Partial<MoveMark>;
    const mark: MoveMark = {
      change: candidate.change === true,
      note: typeof candidate.note === 'string' ? candidate.note : '',
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    };
    if (isMarked(mark)) result[key] = mark;
  }
  return result;
}

type MarkStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads the saved marks; empty when there are none or storage is
 * unavailable (private window, blocked site data, corrupt payload). */
export function loadMarks(storage: MarkStorage | null): ReviewMarks {
  try {
    const raw = storage?.getItem(REVIEW_STORAGE_KEY);
    return raw ? parseMarks(raw) : {};
  } catch {
    return {};
  }
}

export function saveMarks(storage: MarkStorage | null, marks: ReviewMarks): void {
  try {
    storage?.setItem(REVIEW_STORAGE_KEY, serializeMarks(marks));
  } catch {
    // Storage full or blocked: the in-memory marks still work for this session.
  }
}

function markdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** The marked moves as a Markdown table, one row per move, sorted by name —
 * the shape to paste into a chat or an issue when handing the list over. */
export function marksToMarkdown(marks: ReviewMarks, catalog: readonly ReviewMove[], now: Date = new Date()): string {
  const byId = new Map(catalog.map((entry) => [entry.move.id, entry]));
  const rows = Object.entries(marks)
    .filter(([, mark]) => isMarked(mark))
    .map(([key, mark]) => ({ id: Number(key), mark, entry: byId.get(Number(key)) }))
    .sort((a, b) => (a.entry?.move.name ?? '').localeCompare(b.entry?.move.name ?? '') || a.id - b.id);

  const lines = [
    `# Move VFX review — ${rows.length} marked (${now.toISOString().slice(0, 10)})`,
    '',
    '| # | Move | Type | Category | Animation today | Change? | Note |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const { id, mark, entry } of rows) {
    const move = entry?.move;
    lines.push(
      [
        String(id),
        move?.name ?? `move#${id}`,
        move?.type ?? '',
        move?.category ?? '',
        entry ? describeSource(entry.source) : '',
        mark.change ? 'yes' : '',
        markdownCell(mark.note),
      ]
        .map((cell) => `| ${cell} `)
        .join('') + '|'
    );
  }
  return lines.join('\n');
}
