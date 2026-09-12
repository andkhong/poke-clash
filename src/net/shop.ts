/** The in-match item shop's catalog and limits, shared by game-server (which
 * enforces them) and the client (which pre-checks them so a doomed tap is
 * disabled rather than bounced) — same shared-boundary idea as predictions.ts
 * and chat.ts.
 *
 * Why the limits look the way they do: a room's wallets are per-tab, minted
 * at STARTING_BALANCE the first time the server sees a session id (see
 * game-server/wallets.ts), and that id is client-minted — so price alone is
 * not a real limit. Fifty chatters is $5,000 of potions, and clearing
 * sessionStorage mints another $100. The room-wide per-match stock below is
 * therefore the load-bearing limit: it caps total heals no matter how many
 * wallets exist. The per-session and per-target caps only shape *who* gets
 * the stock and *where* it can land.
 */

import type { MatchPhase } from '../sim/types';

/** The shop takes purchases only while the match is actually being fought —
 * not during the intro parade, and not once it has finished. Unlike betting
 * there's no deadline of its own: the shop stays open for the whole fight,
 * which is the point of it (the pool closes at the aggression mark and this
 * is what's left to spend on).
 *
 * Deliberately a function of the sim phase rather than a flag on the wire:
 * the server gates on it authoritatively, and the client evaluates the same
 * rule against the sim state it already holds, so the panel can never be
 * showing a stale "closed" the server has since moved past. */
export function isShopOpenForPhase(phase: MatchPhase): boolean {
  return phase !== 'intro' && phase !== 'complete';
}

export type ItemId = 'potion' | 'superPotion';

export interface ShopItem {
  id: ItemId;
  /** Shown uppercased in the panel; also used in the system chat line. */
  label: string;
  /** The UI has no icon system at all — no CSS files, no SVG, no icon font —
   * so every glyph in the app is an emoji (see LandingScreen/SetupScreen).
   * These follow that, rather than introducing the codebase's first
   * image-backed button for two items. */
  emoji: string;
  /** Pokémon Dollars. Deliberately steep against a $100 start and a $10
   * per-match watch drip: one Potion is most of a fresh wallet. */
  price: number;
  /** Fraction of the target's maxHp restored. A fraction rather than the
   * games' flat 20/60 HP because maxHp here runs ~155 at level 50 and ~300
   * at level 100 (see sim/statCalc.ts's computeStats) — a flat 20 would be
   * 6-13% and functionally noise. */
  healFraction: number;
  /** How many of this item the whole room may buy in one match, shared by
   * everyone watching. First come, first served. */
  stock: number;
}

export const ITEMS: readonly ShopItem[] = [
  { id: 'potion', label: 'Potion', emoji: '🧪', price: 40, healFraction: 0.25, stock: 3 },
  { id: 'superPotion', label: 'Super Potion', emoji: '🍶', price: 90, healFraction: 0.5, stock: 1 },
];

export const ITEM_IDS: readonly ItemId[] = ITEMS.map((item) => item.id);

export function getItem(id: ItemId): ShopItem {
  const item = ITEMS.find((candidate) => candidate.id === id);
  // Unreachable for a validated id; keeps callers free of null checks.
  if (!item) throw new Error(`unknown item: ${id}`);
  return item;
}

export function isItemId(value: unknown): value is ItemId {
  return typeof value === 'string' && (ITEM_IDS as readonly string[]).includes(value);
}

/** Purchases one session may make per match, across all items. With a total
 * stock of 4 that spreads the shelf over up to 4 different people instead of
 * letting the first viewer with $210 clear it in two taps. */
export const MATCH_ITEM_LIMIT_PER_SESSION = 1;

/** How many times one Pokémon may be healed in a match, by anyone. Without
 * this the whole stock could be poured into a single fighter and make it
 * effectively unkillable. */
export const MAX_HEALS_PER_TARGET = 2;

/** Recent uses kept on ShopSummary for the panel's activity line. */
export const ITEM_USE_LOG_LIMIT = 5;

/** An instance id is built by the sim as `p${slotIndex}-${speciesId}` (see
 * sim/matchSetup.ts). Validated by shape before it is used as a lookup key,
 * same reasoning as isValidSessionId in predictions.ts. */
const INSTANCE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function isValidInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID_RE.test(value);
}
