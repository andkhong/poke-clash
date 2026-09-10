import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReviewFileStore } from './vfxReviewFile';

function withTempRoot(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'vfx-review-'));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('createReviewFileStore', () => {
  it('reports a missing file, then round-trips a write', () => {
    withTempRoot((root) => {
      const store = createReviewFileStore(root);
      expect(store.read()).toEqual({
        path: 'vfx-review/marks.json',
        markdownPath: 'vfx-review/REVIEW.md',
        changesPath: 'vfx-review/changes.json',
        exists: false,
        export: null,
        changes: null,
      });

      // The changes file is the agent's, read but never written here.
      mkdirSync(join(root, 'vfx-review'), { recursive: true });
      writeFileSync(join(root, 'vfx-review/changes.json'), '{"85":{"summary":"arena bolt","changedAt":"2026-09-10T17:00:00.000Z"}}');
      expect(store.read().changes).toEqual({ '85': { summary: 'arena bolt', changedAt: '2026-09-10T17:00:00.000Z' } });

      const exported = {
        version: 1,
        exportedAt: '2026-09-10T12:00:00.000Z',
        marks: { '85': { change: true, note: 'bolt too small', updatedAt: '2026-09-10T12:00:00.000Z' } },
      };
      const result = store.write({ export: exported, markdown: '# Move VFX review' });
      expect(result).toMatchObject({ path: 'vfx-review/marks.json', markdownPath: 'vfx-review/REVIEW.md' });
      expect(new Date(result.savedAt).getTime()).toBeGreaterThan(0);

      expect(store.read()).toMatchObject({ exists: true, export: exported });
      expect(readFileSync(join(root, 'vfx-review/marks.json'), 'utf-8')).toBe(`${JSON.stringify(exported, null, 2)}\n`);
      expect(readFileSync(join(root, 'vfx-review/REVIEW.md'), 'utf-8')).toBe('# Move VFX review\n');
    });
  });

  it('rejects a malformed write and surfaces an unparseable file', () => {
    withTempRoot((root) => {
      const store = createReviewFileStore(root);
      expect(() => store.write({ export: { nope: 1 }, markdown: '' })).toThrow(/Expected/);
      expect(() => store.write({ export: { marks: [] }, markdown: '' })).toThrow(/Expected/);
      expect(() => store.write({ export: { marks: {} }, markdown: 42 as unknown as string })).toThrow(/Expected/);

      mkdirSync(join(root, 'vfx-review'), { recursive: true });
      writeFileSync(join(root, 'vfx-review/marks.json'), '{ not json');
      expect(() => store.read()).toThrow();
    });
  });
});
