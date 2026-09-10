import { describeSource, type ReviewMove } from './moveCatalog';
import { REVIEW_CHANGES_PATH, REVIEW_JSON_PATH } from './reviewFileProtocol';

// The review page's marks — which moves' VFX the reviewer wants changed, why,
// and (once something was done about one) their verdict — kept in the
// browser's localStorage, saved into the repo through the dev server (see
// reviewSync.ts and vite-plugins/vfxReviewFile.ts), and exportable as JSON
// (to re-import elsewhere) or Markdown (to hand to a person or a coding
// agent). Pure functions over plain objects so they're testable without a
// DOM; the page passes in window.localStorage.

export type MarkVerdict = 'approved' | 'changes-requested';

export interface MoveMark {
  /** Flagged as "change this VFX". */
  change: boolean;
  note: string;
  /** ISO timestamp of the last edit. */
  updatedAt: string;
  /** The reviewer's call on the change made for this move (see ReviewChange). */
  verdict?: MarkVerdict;
  /** Notes given with the verdict — what still needs to change. */
  feedback?: string;
  /** When the verdict was given. A change made after it puts the move back
   * under review (see markStatus). */
  verdictAt?: string;
  /** For a move whose pack animation the arena doesn't play (or plays only
   * because the review asked): the reviewer's pick between the pack's
   * assets and the arena's own effect — see ReviewMove.alternative. */
  prefer?: AssetPreference;
}

export type AssetPreference = 'pack' | 'arena';

/** Keyed by move id (as a string, since it's JSON). */
export type ReviewMarks = Record<string, MoveMark>;

/** What was done about a marked move, written by whoever acted on the
 * review (a coding agent) into vfx-review/changes.json, never by the page. */
export interface ReviewChange {
  summary: string;
  /** ISO timestamp; compared with MoveMark.verdictAt to tell a fresh change
   * from one the reviewer already judged. */
  changedAt: string;
}

export type ReviewChanges = Record<string, ReviewChange>;

/** open: marked, nothing done yet. proposed: a change was made and awaits
 * the reviewer's verdict. approved / changes-requested: the verdict, as long
 * as no newer change has superseded it. */
export type MarkStatus = 'open' | 'proposed' | 'approved' | 'changes-requested';

export const REVIEW_STORAGE_KEY = 'poke-clash.vfx-review.v1';

/** The on-disk/downloaded shape: vfx-review/marks.json and "Download JSON". */
export interface ReviewExport {
  version: 1;
  exportedAt: string;
  marks: ReviewMarks;
}

/** A mark worth keeping: flagged, carrying a note, or judged. An unflagged,
 * empty mark is dropped rather than stored. */
export function isMarked(mark: MoveMark | undefined): boolean {
  return (
    !!mark &&
    (mark.change || mark.note.trim().length > 0 || !!mark.verdict || (mark.feedback?.trim().length ?? 0) > 0 || !!mark.prefer)
  );
}

export function countMarked(marks: ReviewMarks): number {
  return Object.values(marks).filter(isMarked).length;
}

export function markStatus(mark: MoveMark | undefined, change: ReviewChange | undefined): MarkStatus {
  if (!change) return 'open';
  if (mark?.verdict && (mark.verdictAt ?? '') >= change.changedAt) return mark.verdict;
  return 'proposed';
}

export function statusCounts(marks: ReviewMarks, changes: ReviewChanges): Record<MarkStatus, number> {
  const counts: Record<MarkStatus, number> = { open: 0, proposed: 0, approved: 0, 'changes-requested': 0 };
  for (const [key, mark] of Object.entries(marks)) {
    if (isMarked(mark)) counts[markStatus(mark, changes[key])] += 1;
  }
  return counts;
}

export type MarkPatch = Partial<Pick<MoveMark, 'change' | 'note' | 'verdict' | 'feedback' | 'prefer'>>;

/** Returns a new marks object with the move's mark patched (never mutates);
 * a mark that ends up with nothing in it is removed. Setting `verdict`
 * stamps `verdictAt`; setting it or `prefer` to undefined withdraws it. */
export function setMark(marks: ReviewMarks, moveId: number, patch: MarkPatch, now: Date = new Date()): ReviewMarks {
  const key = String(moveId);
  const previous = marks[key] ?? { change: false, note: '', updatedAt: '' };
  const next: MoveMark = { ...previous, updatedAt: now.toISOString() };
  if (patch.change !== undefined) next.change = patch.change;
  if (patch.note !== undefined) next.note = patch.note;
  if ('prefer' in patch) {
    if (patch.prefer) next.prefer = patch.prefer;
    else delete next.prefer;
  }
  if (patch.feedback !== undefined) {
    if (patch.feedback === '') delete next.feedback;
    else next.feedback = patch.feedback;
  }
  if ('verdict' in patch) {
    if (patch.verdict) {
      next.verdict = patch.verdict;
      next.verdictAt = now.toISOString();
    } else {
      delete next.verdict;
      delete next.verdictAt;
    }
  }
  const result = { ...marks };
  if (isMarked(next)) result[key] = next;
  else delete result[key];
  return result;
}

export function buildReviewExport(marks: ReviewMarks, now: Date = new Date()): ReviewExport {
  const ordered = Object.fromEntries(
    Object.entries(marks)
      .filter(([, mark]) => isMarked(mark))
      .sort(([a], [b]) => Number(a) - Number(b))
  );
  return { version: 1, exportedAt: now.toISOString(), marks: ordered };
}

export function serializeMarks(marks: ReviewMarks, now: Date = new Date()): string {
  return JSON.stringify(buildReviewExport(marks, now), null, 2);
}

/** Accepts either a full export (`{ version, exportedAt, marks }`) or a bare
 * marks object; anything malformed inside is skipped rather than thrown. */
export function normalizeMarks(raw: unknown): ReviewMarks {
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
    if (candidate.verdict === 'approved' || candidate.verdict === 'changes-requested') {
      mark.verdict = candidate.verdict;
      if (typeof candidate.verdictAt === 'string') mark.verdictAt = candidate.verdictAt;
    }
    if (typeof candidate.feedback === 'string' && candidate.feedback.trim() !== '') mark.feedback = candidate.feedback;
    if (candidate.prefer === 'pack' || candidate.prefer === 'arena') mark.prefer = candidate.prefer;
    if (isMarked(mark)) result[key] = mark;
  }
  return result;
}

export function parseMarks(json: string): ReviewMarks {
  return normalizeMarks(JSON.parse(json));
}

/** The changes file (see REVIEW_CHANGES_PATH): a bare object keyed by move
 * id, or one wrapped as `{ changes: {...} }`. Entries without a summary are
 * skipped. */
export function normalizeChanges(raw: unknown): ReviewChanges {
  const changes = raw && typeof raw === 'object' && 'changes' in raw ? (raw as { changes: unknown }).changes : raw;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('Not a changes file: expected an object keyed by move id');
  }
  const result: ReviewChanges = {};
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (!/^-?\d+$/.test(key) || !value || typeof value !== 'object') continue;
    const candidate = value as Partial<ReviewChange>;
    if (typeof candidate.summary !== 'string' || candidate.summary.trim() === '') continue;
    result[key] = { summary: candidate.summary, changedAt: typeof candidate.changedAt === 'string' ? candidate.changedAt : '' };
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

const STATUS_LABEL: Record<MarkStatus, string> = {
  open: 'open',
  proposed: 'proposed — please review',
  approved: 'approved',
  'changes-requested': 'changes requested',
};

const PREFER_LABEL: Record<AssetPreference, string> = { pack: 'use the pack animation', arena: 'keep the arena effect' };

function markdownCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function markedRows(marks: ReviewMarks, catalog: readonly ReviewMove[]): { id: number; mark: MoveMark; entry: ReviewMove | undefined }[] {
  const byId = new Map(catalog.map((entry) => [entry.move.id, entry]));
  return Object.entries(marks)
    .filter(([, mark]) => isMarked(mark))
    .map(([key, mark]) => ({ id: Number(key), mark, entry: byId.get(Number(key)) }))
    .sort((a, b) => (a.entry?.move.name ?? '').localeCompare(b.entry?.move.name ?? '') || a.id - b.id);
}

/** Just the table: one row per marked move, sorted by name. */
export function marksToMarkdownTable(marks: ReviewMarks, catalog: readonly ReviewMove[], changes: ReviewChanges = {}): string {
  const lines = [
    '| # | Move | Type | Category | Animation today | Change? | Note | Status | Change made | Feedback | Assets |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { id, mark, entry } of markedRows(marks, catalog)) {
    const move = entry?.move;
    const change = changes[String(id)];
    const cells = [
      String(id),
      move?.name ?? `move#${id}`,
      move?.type ?? '',
      move?.category ?? '',
      entry ? describeSource(entry.source) : '',
      mark.change ? 'yes' : '',
      markdownCell(mark.note),
      STATUS_LABEL[markStatus(mark, change)],
      change ? markdownCell(change.summary) : '',
      markdownCell(mark.feedback ?? ''),
      mark.prefer ? PREFER_LABEL[mark.prefer] : '',
    ];
    lines.push(`${cells.map((cell) => `| ${cell} `).join('')}|`);
  }
  return lines.join('\n');
}

export interface MarkdownOptions {
  now?: Date;
  changes?: ReviewChanges;
}

function markdownHeading(marks: ReviewMarks, now: Date): string {
  return `# Move VFX review — ${countMarked(marks)} marked (${now.toISOString().slice(0, 10)})`;
}

/** The marked moves as a Markdown document — the shape to paste into a chat
 * or an issue when handing the list over. */
export function marksToMarkdown(marks: ReviewMarks, catalog: readonly ReviewMove[], options: MarkdownOptions = {}): string {
  const now = options.now ?? new Date();
  return [markdownHeading(marks, now), '', marksToMarkdownTable(marks, catalog, options.changes ?? {})].join('\n');
}

/** The same document with a preamble for whoever (or whatever) picks the
 * file up from the repo: what the columns mean, where the data lives, and
 * how to record a change so the reviewer can judge it. */
export function reviewFileMarkdown(marks: ReviewMarks, catalog: readonly ReviewMove[], options: MarkdownOptions = {}): string {
  const now = options.now ?? new Date();
  const changes = options.changes ?? {};
  const counts = statusCounts(marks, changes);
  const preamble = [
    'Generated by the move-VFX review page (`/review.html`, `src/review/`) — edit marks there, not here.',
    `The source of truth is \`${REVIEW_JSON_PATH}\`; this file is regenerated on every save.`,
    'Each row is a move whose on-screen effect the reviewer wants changed; the note says how.',
    '"Animation today" is what the arena currently draws: `pack …` is that Gen 9 Move Animation Project',
    'sprite animation (see `src/render/vfx/anim/`), `arena …` is one of the arena\'s own family effects',
    '(see `src/render/vfx/moves/`, chosen in `src/render/vfx/moveAnimations.ts`).',
    '',
    `Status: ${counts.open} open · ${counts.proposed} proposed (awaiting review) · ${counts.approved} approved · ${counts['changes-requested']} changes requested.`,
    'open = nothing done yet; proposed = a change was made and awaits the reviewer\'s Before/After verdict on the page;',
    'changes requested = read Feedback and iterate. Whoever acts on a row records what they did in',
    `\`${REVIEW_CHANGES_PATH}\` as \`{ "<move id>": { "summary": "…", "changedAt": "<ISO time>" } }\` — the page then`,
    'shows it next to the move with Before/After playback and the Approve / Request changes controls.',
    '"Assets" is the reviewer\'s pick for a move whose pack animation the arena skips (screen-wide) or plays only',
    'because the review asked: "use the pack animation" means pin it with `usePackAnimation` in',
    '`src/render/vfx/moveVfxAdjustments.ts`; "keep the arena effect" means leave (or restore) the arena\'s own.',
  ].join('\n');
  return [markdownHeading(marks, now), '', preamble, '', marksToMarkdownTable(marks, catalog, changes)].join('\n');
}
