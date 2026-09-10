// What the review page and the dev server's vfx-review-file plugin
// (vite-plugins/vfxReviewFile.ts) agree on: the endpoint, the files it
// keeps in the repo, and the request/response shapes. Pure constants and
// types so both the browser bundle and the Node plugin can import it.

export const REVIEW_FILE_ENDPOINT = '/__vfx-review';
/** The page's source of truth once the dev server has it: the same export
 * format as "Download JSON" (see reviewStore.ts's buildReviewExport). */
export const REVIEW_JSON_PATH = 'vfx-review/marks.json';
/** Readable twin of the JSON, regenerated on every save — the file to hand
 * a coding agent. */
export const REVIEW_MARKDOWN_PATH = 'vfx-review/REVIEW.md';
/** Written by whoever acts on the review (a coding agent), never by the
 * page: `{ "<move id>": { "summary": "...", "changedAt": "<ISO time>" } }`.
 * The page shows each entry next to the move with Before/After playback
 * and the reviewer's verdict (see reviewStore.ts's ReviewChange). */
export const REVIEW_CHANGES_PATH = 'vfx-review/changes.json';

export interface ReviewFileReadResponse {
  path: string;
  markdownPath: string;
  changesPath: string;
  /** False when nothing has been saved yet (`export` is then null). */
  exists: boolean;
  export: unknown;
  /** The changes file's content, or null when there is none. */
  changes: unknown;
}

export interface ReviewFileWriteRequest {
  export: unknown;
  markdown: string;
}

export interface ReviewFileWriteResponse {
  path: string;
  markdownPath: string;
  savedAt: string;
}
