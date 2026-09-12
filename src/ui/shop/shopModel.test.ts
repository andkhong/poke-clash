import { describe, expect, it } from 'vitest';
import type { ItemUse, ShopSummary } from '../../net/protocol';
import type { PokemonInstance, SimState } from '../../sim/types';
import { getItem, ITEMS, MATCH_ITEM_LIMIT_PER_SESSION, MAX_HEALS_PER_TARGET } from '../../net/shop';
import {
  canBuyItem,
  countHealsByTarget,
  healAmount,
  hpColor,
  itemErrorNotice,
  itemTerms,
  itemUseEmoji,
  itemUseText,
  shopNotice,
  stockColor,
  stockLabel,
  stockLeft,
  targetBlockedLabel,
  targetRows,
} from './shopModel';
import { DESTRUCTIVE, SUCCESS, YELLOW } from '../theme';

const POTION = getItem('potion');
const SUPER = getItem('superPotion');

function pokemon(instanceId: string, currentHp: number, maxHp = 200): PokemonInstance {
  return { instanceId, name: instanceId.toUpperCase(), currentHp, maxHp } as PokemonInstance;
}

function stateWith(...mons: PokemonInstance[]): SimState {
  return {
    phase: 'battle',
    allInstanceIds: mons.map((m) => m.instanceId),
    pokemon: Object.fromEntries(mons.map((m) => [m.instanceId, m])),
  } as unknown as SimState;
}

function shopWith(overrides: Partial<ShopSummary> = {}): ShopSummary {
  return {
    matchNo: 1,
    stockLeft: { potion: POTION.stock, superPotion: SUPER.stock },
    healsByTarget: {},
    recent: [],
    ...overrides,
  };
}

describe('healAmount', () => {
  it('is the item fraction of maxHp', () => {
    expect(healAmount(POTION, { currentHp: 20, maxHp: 200 })).toBe(Math.round(200 * POTION.healFraction));
  });

  it('never promises more than the Pokémon is missing', () => {
    expect(healAmount(SUPER, { currentHp: 197, maxHp: 200 })).toBe(3);
    expect(healAmount(POTION, { currentHp: 200, maxHp: 200 })).toBe(0);
  });

  it('rounds up to at least 1 HP on a tiny pool', () => {
    expect(healAmount({ ...POTION, healFraction: 0.0001 }, { currentHp: 1, maxHp: 10 })).toBe(1);
  });
});

describe('targetRows', () => {
  it('lists living fighters in spawn order with their HP and real heal', () => {
    const state = stateWith(pokemon('p0-1', 50), pokemon('p1-2', 100), pokemon('p2-3', 0));
    const rows = targetRows(state, shopWith(), POTION);

    expect(rows.map((r) => r.instanceId)).toEqual(['p0-1', 'p1-2']); // the fainted one is gone
    expect(rows[0]).toMatchObject({ name: 'P0-1', currentHp: 50, maxHp: 200, hpFraction: 0.25, blocked: null });
    expect(rows[0].heal).toBe(Math.round(200 * POTION.healFraction));
  });

  it('blocks a full-HP target and one that has had its share', () => {
    const state = stateWith(pokemon('p0-1', 200), pokemon('p1-2', 50));
    const rows = targetRows(state, shopWith({ healsByTarget: { 'p1-2': MAX_HEALS_PER_TARGET } }), POTION);

    expect(rows.find((r) => r.instanceId === 'p0-1')!.blocked).toBe('full_hp');
    expect(rows.find((r) => r.instanceId === 'p1-2')!.blocked).toBe('target_limit');
    expect(targetBlockedLabel('full_hp')).toBe('FULL');
    expect(targetBlockedLabel('target_limit')).toBe('MAXED');
  });

  it('still allows a target one heal short of the cap', () => {
    const state = stateWith(pokemon('p0-1', 50));
    const heals = { 'p0-1': MAX_HEALS_PER_TARGET - 1 };
    expect(targetRows(state, shopWith({ healsByTarget: heals }), POTION)[0].blocked).toBeNull();
  });
});

describe('countHealsByTarget', () => {
  it("reports the server's per-Pokémon count", () => {
    const counts = countHealsByTarget(shopWith({ healsByTarget: { a: 2, b: 1 } }));
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
  });

  // The old implementation tallied `recent`, which the server truncates to
  // ITEM_USE_LOG_LIMIT — so a deep shelf silently under-counted and the panel
  // offered a target that was already maxed out.
  it('is unaffected by a use log that has been trimmed', () => {
    const counts = countHealsByTarget(shopWith({ healsByTarget: { a: 2 }, recent: [] }));
    expect(counts.get('a')).toBe(2);
  });
});

describe('canBuyItem', () => {
  const state = stateWith(pokemon('p0-1', 50));

  it('allows a purchase with stock, money and an unused allowance', () => {
    expect(canBuyItem(state, shopWith(), POTION, POTION.price, 0, true)).toBe(true);
  });

  it('refuses without the money, the stock, or the allowance', () => {
    expect(canBuyItem(state, shopWith(), POTION, POTION.price - 1, 0, true)).toBe(false);
    expect(canBuyItem(state, shopWith({ stockLeft: { potion: 0, superPotion: 1 } }), POTION, 999, 0, true)).toBe(false);
    expect(canBuyItem(state, shopWith(), POTION, 999, MATCH_ITEM_LIMIT_PER_SESSION, true)).toBe(false);
  });

  it('refuses outside the battle, and in a read-only embed', () => {
    expect(canBuyItem({ ...state, phase: 'intro' } as SimState, shopWith(), POTION, 999, 0, true)).toBe(false);
    expect(canBuyItem({ ...state, phase: 'complete' } as SimState, shopWith(), POTION, 999, 0, true)).toBe(false);
    expect(canBuyItem(state, shopWith(), POTION, 999, 0, false)).toBe(false);
  });
});

describe('stock display', () => {
  it('labels and colours the shelf, flagging the last one and the empty one', () => {
    expect(stockLabel(shopWith({ stockLeft: { potion: 3, superPotion: 1 } }), POTION)).toBe('3 left');
    expect(stockLabel(shopWith({ stockLeft: { potion: 0, superPotion: 1 } }), POTION)).toBe('SOLD OUT');

    expect(stockColor(shopWith({ stockLeft: { potion: 3, superPotion: 1 } }), POTION)).toBeNull();
    expect(stockColor(shopWith({ stockLeft: { potion: 1, superPotion: 1 } }), POTION)).toBe(YELLOW);
    expect(stockColor(shopWith({ stockLeft: { potion: 0, superPotion: 1 } }), POTION)).toBe(DESTRUCTIVE);
    expect(stockLeft(shopWith({ stockLeft: { potion: 2, superPotion: 0 } }), SUPER)).toBe(0);
  });

  it('states an item terms as a percentage and a price', () => {
    expect(itemTerms(POTION)).toBe(`+${Math.round(POTION.healFraction * 100)}% HP · $${POTION.price}`);
  });
});

describe('shopNotice', () => {
  const state = stateWith(pokemon('p0-1', 50));
  const cheapest = Math.min(...ITEMS.map((i) => i.price));

  it('says nothing when the shop can be used', () => {
    expect(shopNotice(state, shopWith(), 999, 0, true)).toBeNull();
  });

  it('explains the intro, the end of the match, a spent allowance and an empty shelf', () => {
    expect(shopNotice({ ...state, phase: 'intro' } as SimState, shopWith(), 999, 0, true)).toMatch(/battle starts/);
    expect(shopNotice({ ...state, phase: 'complete' } as SimState, shopWith(), 999, 0, true)).toMatch(/closed/);
    expect(shopNotice(state, shopWith(), 999, MATCH_ITEM_LIMIT_PER_SESSION, true)).toMatch(/match/);
    expect(shopNotice(state, shopWith({ stockLeft: { potion: 0, superPotion: 0 } }), 999, 0, true)).toMatch(/sold out/);
  });

  it('mentions money only when nothing in stock is affordable', () => {
    expect(shopNotice(state, shopWith(), cheapest - 1, 0, true)).toMatch(/Not enough/);
    expect(shopNotice(state, shopWith(), cheapest, 0, true)).toBeNull();
    // The cheap item is gone, so the expensive one sets the bar.
    expect(shopNotice(state, shopWith({ stockLeft: { potion: 0, superPotion: 1 } }), SUPER.price - 1, 0, true)).toMatch(/Not enough/);
  });

  it('stays quiet in a read-only embed, which has nothing to explain', () => {
    expect(shopNotice({ ...state, phase: 'complete' } as SimState, shopWith(), 0, 9, false)).toBeNull();
  });
});

describe('activity log', () => {
  it('reads as buyer, target and HP restored, with the item emoji', () => {
    const entry: ItemUse = { itemId: 'superPotion', targetInstanceId: 'p0-1', targetName: 'Piplup', buyerName: 'Slowpoke482', amount: 87, atMs: 0 };
    expect(itemUseText(entry)).toBe('Slowpoke482 → Piplup +87');
    expect(itemUseEmoji(entry)).toBe(SUPER.emoji);
  });
});

describe('itemErrorNotice', () => {
  it('maps each server rejection to its own short line', () => {
    const codes = ['closed', 'out_of_stock', 'session_limit', 'target_fainted', 'target_full_hp', 'target_limit', 'insufficient_funds', 'rate_limited', 'no_shop'];
    const notices = codes.map(itemErrorNotice);
    expect(new Set(notices).size).toBe(codes.length); // every code says something different
    expect(itemErrorNotice('something_unexpected')).toBe('Couldn’t buy that');
  });
});

describe('hpColor', () => {
  it('uses the roster HUD thresholds', () => {
    expect(hpColor(0.9)).toBe(SUCCESS);
    expect(hpColor(0.5)).toBe(YELLOW);
    expect(hpColor(0.2)).toBe(DESTRUCTIVE);
  });
});
