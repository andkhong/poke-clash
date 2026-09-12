import type { SimState } from '../src/sim/types';
import type { ItemUse, ShopSummary } from '../src/net/protocol';
import {
  getItem,
  isItemId,
  ITEMS,
  isShopOpenForPhase,
  ITEM_USE_LOG_LIMIT,
  MATCH_ITEM_LIMIT_PER_SESSION,
  MAX_HEALS_PER_TARGET,
  type ItemId,
  type ShopItem,
} from '../src/net/shop';

/** One room's item shop for one match — pure bookkeeping over a sim state
 * snapshot, with no wallet, timer or SSE knowledge, exactly like its sibling
 * predictions.ts: roomManager owns when to open/clear it and moves the money;
 * this module says what the shelf looks like and whether a purchase is
 * allowed. Everything here is synchronous and deterministic so it can be
 * unit-tested without a room or an engine.
 *
 * The heal itself is injected as a callback rather than imported, which keeps
 * this module free of any engine dependency while still making a purchase a
 * single atomic step: stock is only ever consumed on a heal that actually
 * landed.
 */

export interface ShopState {
  matchNo: number;
  /** Units left of each item, room-wide, for this match. */
  stockLeft: Record<ItemId, number>;
  /** Purchases per session id — never serialised as-is (see toShopSummary). */
  usesBySession: Map<string, number>;
  /** Heals landed on each instance id, capped at MAX_HEALS_PER_TARGET. */
  usesByTarget: Map<string, number>;
  /** Every use this match, oldest first; the summary sends only the tail. */
  log: ItemUse[];
}

export type PurchaseItemError =
  | 'no_shop'
  | 'closed'
  | 'unknown_item'
  | 'out_of_stock'
  | 'session_limit'
  | 'unknown_target'
  | 'target_fainted'
  | 'target_full_hp'
  | 'target_limit'
  | 'insufficient_funds'
  | 'heal_failed';

export function openShop(matchNo: number): ShopState {
  const stockLeft = {} as Record<ItemId, number>;
  for (const item of ITEMS) stockLeft[item.id] = item.stock;
  return { matchNo, stockLeft, usesBySession: new Map(), usesByTarget: new Map(), log: [] };
}

/** Whether the shop is trading, against this state — see isShopOpenForPhase
 * for why the rule lives in the shared module. */
export function isShopOpen(state: Readonly<SimState>): boolean {
  return isShopOpenForPhase(state.phase);
}

/** Records a purchase and applies its heal. Checks run in the order a buyer
 * would want to hear about them (is there a shop → is it open → is the item
 * real → is any left → have I already bought → is the target real → is it
 * still standing → does it even need healing → has it had its share → can I
 * afford it). Mutates the shop on success; the caller debits the wallet.
 *
 * `applyHeal` is SimulationEngine.applyItemHeal bound to the target; it
 * returns the HP actually restored. Every condition it refuses on is already
 * checked above it, so a null here means something changed underneath us and
 * nothing is charged. */
export function purchaseItem(
  shop: ShopState | null,
  state: Readonly<SimState>,
  sessionId: string,
  itemId: string,
  targetInstanceId: string,
  balance: number,
  buyerName: string,
  nowMs: number,
  applyHeal: (item: ShopItem) => number | null
): { ok: true; item: ShopItem; use: ItemUse } | { ok: false; error: PurchaseItemError } {
  if (!shop) return { ok: false, error: 'no_shop' };
  if (!isShopOpen(state)) return { ok: false, error: 'closed' };
  if (!isItemId(itemId)) return { ok: false, error: 'unknown_item' };

  const item = getItem(itemId);
  if ((shop.stockLeft[item.id] ?? 0) <= 0) return { ok: false, error: 'out_of_stock' };
  if ((shop.usesBySession.get(sessionId) ?? 0) >= MATCH_ITEM_LIMIT_PER_SESSION) return { ok: false, error: 'session_limit' };

  const target = state.pokemon[targetInstanceId];
  if (!target) return { ok: false, error: 'unknown_target' };
  if (target.currentHp <= 0) return { ok: false, error: 'target_fainted' };
  if (target.currentHp >= target.maxHp) return { ok: false, error: 'target_full_hp' };
  if ((shop.usesByTarget.get(targetInstanceId) ?? 0) >= MAX_HEALS_PER_TARGET) return { ok: false, error: 'target_limit' };
  if (item.price > balance) return { ok: false, error: 'insufficient_funds' };

  const amount = applyHeal(item);
  if (amount === null) return { ok: false, error: 'heal_failed' };

  shop.stockLeft[item.id] -= 1;
  shop.usesBySession.set(sessionId, (shop.usesBySession.get(sessionId) ?? 0) + 1);
  shop.usesByTarget.set(targetInstanceId, (shop.usesByTarget.get(targetInstanceId) ?? 0) + 1);

  const use: ItemUse = {
    itemId: item.id,
    targetInstanceId,
    targetName: target.name,
    buyerName,
    amount,
    atMs: nowMs,
  };
  shop.log.push(use);
  return { ok: true, item, use };
}

/** How many purchases this session has made this match — what
 * SessionPrivate.myItemUses carries, so a reload can't reset the cap. */
export function itemUsesForSession(shop: ShopState | null, sessionId: string): number {
  return shop?.usesBySession.get(sessionId) ?? 0;
}

/** The public view: stock and recent activity, never a session id. */
export function toShopSummary(shop: ShopState): ShopSummary {
  return {
    matchNo: shop.matchNo,
    stockLeft: { ...shop.stockLeft },
    recent: shop.log.slice(-ITEM_USE_LOG_LIMIT),
  };
}
