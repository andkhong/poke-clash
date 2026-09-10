/** Parses a single-range `Range: bytes=start-end` header against a file of
 * `size` bytes into an inclusive [start, end], or null for no range, a
 * malformed one, or one that starts past the end (the caller answers 416
 * for a header that was present but unusable). Either bound may be omitted
 * ("bytes=1000-" streams to the end, "bytes=-500" is the last 500 bytes),
 * and an end past the file is clamped, per RFC 9110. Multi-range requests
 * aren't supported — browsers don't send them for media — and are treated
 * as malformed. */
export function parseByteRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Math.min(size, Number(match[2]));
    if (suffix === 0) return null;
    start = size - suffix;
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(size - 1, Number(match[2]));
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
