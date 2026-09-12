/** Prediction (betting) rules shared by game-server (which enforces them) and
 * the client (which pre-checks them) — same shared-boundary idea as chat.ts. */

/** Starting stake choices in the panel; "ALL IN" is the whole balance. */
export const STAKE_CHIPS: readonly number[] = [10, 25, 50];

/** Smallest accepted bet, in Pokémon Dollars. */
export const MIN_BET = 1;

/** A session id is minted client-side (see sessionIdentity.ts — a UUID) and
 * doubles as that tab's wallet bearer token, so it's validated by shape only:
 * the server never trusts a request just because it carries one, but it also
 * must never take an arbitrary string as a Map key. */
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_RE.test(value);
}
