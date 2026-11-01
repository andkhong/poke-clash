/** Chat rate limit, per sender: up to CHAT_BURST messages at once, then one
 * more every CHAT_REFILL_MS. Generous enough for the quick-reaction chips
 * (one tap each), tight enough that one sender can't flood a room. */
export const CHAT_BURST = 4;
export const CHAT_REFILL_MS = 1500;

/** Item-shop rate limit, per session — far tighter than chat's, because a
 * purchase is a rare, deliberate act. */
export const ITEM_BURST = 3;
export const ITEM_REFILL_MS = 3000;

/** A lazy token bucket — nothing ticks; it's refilled from the clock whenever
 * it's next consulted (see takeToken). */
export interface RateBucket {
  tokens: number;
  lastRefillMs: number;
}

/** Consumes one token from `key`'s bucket in `buckets`, refilling it from the
 * clock first. `key` is just a bucket identity, opaque here. */
export function takeToken(buckets: Map<string, RateBucket>, key: string, burst: number, refillMs: number, nowMs: number): boolean {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: burst, lastRefillMs: nowMs };
    buckets.set(key, bucket);
  }
  const refills = Math.floor((nowMs - bucket.lastRefillMs) / refillMs);
  if (refills > 0) {
    bucket.tokens = Math.min(burst, bucket.tokens + refills);
    // Once full, time stops accruing — otherwise a long quiet stretch would
    // bank a partial refill and hand out the next token early.
    bucket.lastRefillMs = bucket.tokens === burst ? nowMs : bucket.lastRefillMs + refills * refillMs;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}
