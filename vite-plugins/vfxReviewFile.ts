import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
  REVIEW_CHANGES_PATH,
  REVIEW_FILE_ENDPOINT,
  REVIEW_JSON_PATH,
  REVIEW_MARKDOWN_PATH,
  type ReviewFileReadResponse,
  type ReviewFileWriteRequest,
  type ReviewFileWriteResponse,
} from '../src/review/reviewFileProtocol';

// Dev-server persistence for the move-VFX review page (src/review/): the
// page GETs the saved marks when it opens and PUTs them, plus a Markdown
// rendering, whenever they change, so the review lives in the repo where a
// coding agent can read it — vfx-review/marks.json is what the page
// reloads, vfx-review/REVIEW.md the readable twin. Dev only: the production
// build has no server behind this path (Caddy answers with index.html, which
// the page detects and treats as "browser only").

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface ReviewFileStore {
  read(): ReviewFileReadResponse;
  write(body: ReviewFileWriteRequest): ReviewFileWriteResponse;
}

/** Reads/writes the two review files under `root`. Throws on a malformed
 * write body or an unparseable existing JSON file. */
export function createReviewFileStore(root: string): ReviewFileStore {
  const jsonFile = resolve(root, REVIEW_JSON_PATH);
  const markdownFile = resolve(root, REVIEW_MARKDOWN_PATH);
  const changesFile = resolve(root, REVIEW_CHANGES_PATH);
  return {
    read() {
      const exists = existsSync(jsonFile);
      const exported: unknown = exists ? JSON.parse(readFileSync(jsonFile, 'utf-8')) : null;
      const changes: unknown = existsSync(changesFile) ? JSON.parse(readFileSync(changesFile, 'utf-8')) : null;
      return {
        path: REVIEW_JSON_PATH,
        markdownPath: REVIEW_MARKDOWN_PATH,
        changesPath: REVIEW_CHANGES_PATH,
        exists,
        export: exported,
        changes,
      };
    },
    write(body) {
      if (!isReviewExport(body.export) || typeof body.markdown !== 'string') {
        throw new Error('Expected { export: { marks: { ... } }, markdown: string }');
      }
      mkdirSync(dirname(jsonFile), { recursive: true });
      writeFileSync(jsonFile, `${JSON.stringify(body.export, null, 2)}\n`);
      writeFileSync(markdownFile, body.markdown.endsWith('\n') ? body.markdown : `${body.markdown}\n`);
      return { path: REVIEW_JSON_PATH, markdownPath: REVIEW_MARKDOWN_PATH, savedAt: new Date().toISOString() };
    },
  };
}

function isReviewExport(value: unknown): value is { marks: Record<string, unknown> } {
  if (!value || typeof value !== 'object') return false;
  const marks = (value as { marks?: unknown }).marks;
  return !!marks && typeof marks === 'object' && !Array.isArray(marks);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function vfxReviewFilePlugin(): Plugin {
  return {
    name: 'vfx-review-file',
    configureServer(server) {
      const store = createReviewFileStore(server.config.root);
      server.middlewares.use(REVIEW_FILE_ENDPOINT, (req, res, next) => {
        void (async () => {
          try {
            if (req.method === 'GET') {
              sendJson(res, 200, store.read());
            } else if (req.method === 'PUT') {
              const body = JSON.parse(await readBody(req)) as ReviewFileWriteRequest;
              sendJson(res, 200, store.write(body));
            } else {
              next();
            }
          } catch (error) {
            sendJson(res, 400, { error: (error as Error).message });
          }
        })();
      });
    },
  };
}
