import type { IncomingMessage, ServerResponse } from 'node:http';

/** Largest request body the API accepts — every real request is well under
 * 1 KB (a mode + arena, or a playerId + speciesId). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** A request the server answers with a 4xx rather than treating as a bug: a
 * body that isn't JSON, is too large, or fails validation. Anything else
 * thrown while serving a request is a 500 (see server.ts). */
export class BadRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400
  ) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

/** The request body parsed as a JSON object. Throws BadRequestError for a
 * body that's too large, isn't valid JSON, or isn't an object — never a
 * bare exception, which (from the async request handler) would be an
 * unhandled rejection and take the whole server process down. */
export async function readJsonBody<T extends object>(req: IncomingMessage): Promise<Partial<T>> {
  const chunks: Buffer[] = [];
  let size = 0;
  // destroyOnReturn: false — leaving the loop early (the throw below) must
  // not destroy the request, or the 413 could never be sent and the client
  // would just see a dropped connection. Node drains and discards whatever
  // is left of the body once the response has gone out.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += (chunk as Buffer).length;
    if (size > MAX_JSON_BODY_BYTES) throw new BadRequestError('body_too_large', 413);
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError('invalid_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError('invalid_json');
  }
  return parsed as Partial<T>;
}
