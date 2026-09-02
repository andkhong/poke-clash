// A match can trigger 60-120+ sprite requests almost simultaneously (front +
// back, across up to 16 species, sometimes cascading into a fallback tier too).
// Firing them all at once was observed to get every single one rejected with
// 503 by Showdown's CDN, even though the exact same URLs succeed fine when
// requested sequentially/at low concurrency. This throttles + paces requests
// and retries a 503 with backoff (which typically means "you're going too
// fast", not "this doesn't exist").
const MAX_CONCURRENT = 4;
const STAGGER_MS = 70;

let active = 0;
const queue: (() => void)[] = [];

export async function acquireSpriteSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
}

export function releaseSpriteSlot(): void {
  active -= 1;
  const next = queue.shift();
  if (next) setTimeout(next, STAGGER_MS);
}

export async function throttledFetch(url: string): Promise<Response> {
  await acquireSpriteSlot();
  try {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url);
      if (res.status !== 503) return res;
      last = res;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
    return last!;
  } finally {
    releaseSpriteSlot();
  }
}
