import type { ItemUse, ShopSummary } from '../../net/protocol';
import type { PokemonInstance, SimState } from '../../sim/types';
import { getItem, isShopOpenForPhase, ITEMS, MATCH_ITEM_LIMIT_PER_SESSION, MAX_HEALS_PER_TARGET, type ShopItem } from '../../net/shop';
import { formatDollars } from '../predictions/predictionModel';
import { DESTRUCTIVE, SUCCESS, YELLOW } from '../theme';

/** Pure shop-panel presentation logic, kept out of the component so it can be
 * unit-tested under Vitest's node environment — the same split
 * predictionModel.ts and chatModel.ts already use. */

/** One fighter as the target list shows it. */
export interface TargetRow {
  instanceId: string;
  name: string;
  currentHp: number;
  maxHp: number;
  /** 0-1, for the bar. */
  hpFraction: number;
  /** HP this item would actually restore here, already clamped to what the
   * Pokémon is missing — so the list promises the real number rather than the
   * item's nominal one. */
  heal: number;
  /** Why this row can't be picked, or null if it can. */
  blocked: TargetBlockReason | null;
}

export type TargetBlockReason = 'full_hp' | 'target_limit';

/** Every living fighter in spawn order — the same order the roster HUD uses
 * (allInstanceIds, not livingOrder), minus the fainted, since nothing here
 * can revive. */
export function targetRows(state: SimState, shop: ShopSummary, item: ShopItem): TargetRow[] {
  const healsByTarget = countHealsByTarget(shop);
  const rows: TargetRow[] = [];
  for (const instanceId of state.allInstanceIds) {
    const pokemon = state.pokemon[instanceId];
    if (!pokemon || pokemon.currentHp <= 0) continue;
    rows.push({
      instanceId,
      name: pokemon.name,
      currentHp: pokemon.currentHp,
      maxHp: pokemon.maxHp,
      hpFraction: pokemon.maxHp > 0 ? pokemon.currentHp / pokemon.maxHp : 0,
      heal: healAmount(item, pokemon),
      blocked: blockReason(pokemon, healsByTarget.get(instanceId) ?? 0),
    });
  }
  return rows;
}

/** What the server's engine.applyItemHeal would restore here: the item's
 * fraction of maxHp, at least 1, capped by what's actually missing. Kept in
 * step with that method by hand — it's two lines on each side, and the server
 * is authoritative either way; this only sets the expectation. */
export function healAmount(item: ShopItem, pokemon: Pick<PokemonInstance, 'currentHp' | 'maxHp'>): number {
  const missing = Math.max(0, pokemon.maxHp - pokemon.currentHp);
  return Math.min(Math.max(1, Math.round(pokemon.maxHp * item.healFraction)), missing);
}

function blockReason(pokemon: Pick<PokemonInstance, 'currentHp' | 'maxHp'>, healsSoFar: number): TargetBlockReason | null {
  if (pokemon.currentHp >= pokemon.maxHp) return 'full_hp';
  if (healsSoFar >= MAX_HEALS_PER_TARGET) return 'target_limit';
  return null;
}

/** How many heals each Pokémon has had this match — the server's own count
 * (ShopSummary.healsByTarget), not a tally of the truncated `recent` log,
 * which would undercount once the shelf is deeper than ITEM_USE_LOG_LIMIT.
 * The server enforces the real cap regardless; this greys the row out early. */
export function countHealsByTarget(shop: ShopSummary): Map<string, number> {
  return new Map(Object.entries(shop.healsByTarget));
}

/** Whether tapping this item would be accepted right now — mirrors the
 * server's purchaseItem rules so a doomed tap is disabled, not bounced. The
 * per-target rules are per-row (see TargetRow.blocked), so this covers only
 * the shelf, the wallet and this session's own cap. */
export function canBuyItem(
  state: SimState,
  shop: ShopSummary,
  item: ShopItem,
  balance: number,
  myItemUses: number,
  canBuy: boolean
): boolean {
  if (!canBuy || !isShopOpenForPhase(state.phase)) return false;
  if (stockLeft(shop, item) <= 0) return false;
  if (myItemUses >= MATCH_ITEM_LIMIT_PER_SESSION) return false;
  return balance >= item.price;
}

export function stockLeft(shop: ShopSummary, item: ShopItem): number {
  return shop.stockLeft[item.id] ?? 0;
}

/** "3 left" / "SOLD OUT" — the shelf line under an item. */
export function stockLabel(shop: ShopSummary, item: ShopItem): string {
  const left = stockLeft(shop, item);
  return left <= 0 ? 'SOLD OUT' : `${left} left`;
}

/** Red once the shelf is bare, amber on the last one, plain otherwise —
 * "last one" being the state worth reacting to. */
export function stockColor(shop: ShopSummary, item: ShopItem): string | null {
  const left = stockLeft(shop, item);
  if (left <= 0) return DESTRUCTIVE;
  if (left === 1) return YELLOW;
  return null;
}

/** "+25% HP · $40" — an item's headline terms. */
export function itemTerms(item: ShopItem): string {
  return `+${Math.round(item.healFraction * 100)}% HP · ${formatDollars(item.price)}`;
}

/** Why the panel can't be used at all right now, as one line — or null when
 * it can. Ordered the way a buyer would want to hear it: is the shop even
 * trading → have I already bought → is there anything left → can I afford it. */
export function shopNotice(
  state: SimState,
  shop: ShopSummary,
  balance: number,
  myItemUses: number,
  canBuy: boolean
): string | null {
  if (!canBuy) return null;
  if (state.phase === 'intro') return 'Shop opens when the battle starts';
  if (state.phase === 'complete') return 'Shop closed — match over';
  if (myItemUses >= MATCH_ITEM_LIMIT_PER_SESSION) {
    return MATCH_ITEM_LIMIT_PER_SESSION === 1 ? 'One item per match — yours is spent' : 'You have used all your items this match';
  }
  const inStock = ITEMS.filter((item) => stockLeft(shop, item) > 0);
  if (inStock.length === 0) return 'Everything is sold out this match';
  if (balance < Math.min(...inStock.map((item) => item.price))) return 'Not enough Pokémon Dollars';
  return null;
}

/** "Slowpoke482 → Piplup +87" — one line of the activity log. */
export function itemUseText(use: ItemUse): string {
  return `${use.buyerName} → ${use.targetName} +${use.amount}`;
}

/** The emoji for a logged use, looked up from the catalog. */
export function itemUseEmoji(use: ItemUse): string {
  return getItem(use.itemId).emoji;
}

/** Short user-facing notice for a rejected purchase (server error codes from
 * game-server/shop.ts's PurchaseItemError, plus the route's rate limit and
 * the client's own fallback). */
export function itemErrorNotice(error: string): string {
  switch (error) {
    case 'closed':
      return 'Shop is closed';
    case 'out_of_stock':
      return 'Just sold out';
    case 'session_limit':
      return 'One item per match';
    case 'target_fainted':
      return 'That one already fainted';
    case 'target_full_hp':
      return 'Already at full HP';
    case 'target_limit':
      return 'That one has had enough';
    case 'insufficient_funds':
      return 'Not enough Pokémon Dollars';
    case 'rate_limited':
      return 'Slow down a moment';
    case 'no_shop':
      return 'No match to shop in';
    default:
      return 'Couldn’t buy that';
  }
}

/** Why a target row is disabled, as a short tag shown in place of its heal. */
export function targetBlockedLabel(reason: TargetBlockReason): string {
  return reason === 'full_hp' ? 'FULL' : 'MAXED';
}

/** HP-bar colour, matching the roster HUD's thresholds so a fighter reads the
 * same in both places. */
export function hpColor(fraction: number): string {
  if (fraction > 0.5) return SUCCESS;
  if (fraction > 0.2) return YELLOW;
  return DESTRUCTIVE;
}
