import {
  REVIEW_FILE_ENDPOINT,
  type ReviewFileReadResponse,
  type ReviewFileWriteRequest,
  type ReviewFileWriteResponse,
} from './reviewFileProtocol';

// The page's side of the dev server's review-file endpoint (see
// vite-plugins/vfxReviewFile.ts). On the deployed site there's no such
// endpoint — Caddy answers the path with index.html — so anything that
// isn't a JSON reply is read as "not available" and the page stays on
// localStorage alone.

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('application/json');
}

/** The saved review, or null when the dev server (and so the file) isn't
 * there. Throws when the server is there but the file can't be read. */
export async function fetchReviewFile(): Promise<ReviewFileReadResponse | null> {
  let response: Response;
  try {
    response = await fetch(REVIEW_FILE_ENDPOINT, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (!isJsonResponse(response)) return null;
  const body = (await response.json()) as Partial<ReviewFileReadResponse> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  if (typeof body.path !== 'string' || typeof body.exists !== 'boolean') return null;
  return body as ReviewFileReadResponse;
}

export async function saveReviewFile(request: ReviewFileWriteRequest): Promise<ReviewFileWriteResponse> {
  const response = await fetch(REVIEW_FILE_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!isJsonResponse(response)) throw new Error('the dev server did not answer');
  const body = (await response.json()) as Partial<ReviewFileWriteResponse> & { error?: string };
  if (!response.ok || typeof body.savedAt !== 'string') throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as ReviewFileWriteResponse;
}
