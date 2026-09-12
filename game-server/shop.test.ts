import { describe, expect, it } from 'vitest';
import { isShopOpen, itemUsesForSession, openShop, purchaseItem, toShopSummary, type ShopState } from './shop';
import { createMatch } from '../src/sim/matchSetup';
import { createRng } from '../src/sim/rng';
import type { MatchConfig, SimState } from '../src/sim/types';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../src/sim/constants';
import { buildSpeciesMapForLevel, hasPmdSprite, listAllSpecies, moveLookup } from '../src/data/loader';
import { getItem, ITEM_USE_LOG_LIMIT, MATCH_ITEM_LIMIT_PER_SESSION, MAX_HEALS_PER_TARGET } from '../src/net/shop';

const SPECIES = listAllSpecies()
  .filter((s) => hasPmdSprite(s.id))
  .slice(0, 4)
  .map((s) => s.id);

function stateFor(): SimState {
  const config: MatchConfig = {
    level: 50,
    speciesIds: SPECIES,
    arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
    shiny: false,
  };
  const state = createMatch(config, buildSpeciesMapForLevel(SPECIES, 50), moveLookup, createRng(7));
  // createMatch opens in the intro parade; the shop only trades mid-fight.
  state.phase = 'battle';
  return state;
}

/** Everyone starts at full HP, which the shop refuses outright — hurt the
 * target first so the interesting rules are the ones under test. */
function hurt(state: SimState, id: string, fraction = 0.5): void {
  state.pokemon[id].currentHp = Math.max(1, Math.round(state.pokemon[id].maxHp * fraction));
}

/** Stands in for SimulationEngine.applyItemHeal — the real one is exercised
 * in src/sim/engine.test.ts; here it just has to move HP and report it. */
function healer(state: SimState, id: string) {
  return (item: { healFraction: number }): number | null => {
    const target = state.pokemon[id];
    const amount = Math.min(Math.max(1, Math.round(target.maxHp * item.healFraction)), target.maxHp - target.currentHp);
    target.currentHp += amount;
    return amount;
  };
}

function buy(
  shop: ShopState | null,
  state: SimState,
  sessionId: string,
  itemId: string,
  targetId: string,
  balance = 1000,
  buyerName = 'Tester'
) {
  return purchaseItem(shop, state, sessionId, itemId, targetId, balance, buyerName, 1000, healer(state, targetId));
}

describe('openShop', () => {
  it('stocks every catalog item at its full quantity', () => {
    const shop = openShop(1);
    expect(shop.stockLeft).toEqual({ potion: getItem('potion').stock, superPotion: getItem('superPotion').stock });
    expect(shop.log).toEqual([]);
  });
});

describe('purchaseItem', () => {
  it('heals the target, consumes stock, and records the use', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    hurt(state, id, 0.5);
    const before = state.pokemon[id].currentHp;

    const result = buy(shop, state, 's1', 'potion', id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.id).toBe('potion');
    expect(state.pokemon[id].currentHp).toBeGreaterThan(before);
    expect(result.use.amount).toBe(state.pokemon[id].currentHp - before);
    expect(result.use.targetName).toBe(state.pokemon[id].name);
    expect(result.use.buyerName).toBe('Tester');
    expect(shop.stockLeft.potion).toBe(getItem('potion').stock - 1);
    expect(shop.log).toHaveLength(1);
  });

  it('rejects an unknown item, an unknown target, and a fainted target', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [alive, downed] = state.allInstanceIds;
    hurt(state, alive);
    state.pokemon[downed].currentHp = 0;

    expect(buy(shop, state, 's1', 'megaPotion', alive)).toEqual({ ok: false, error: 'unknown_item' });
    expect(buy(shop, state, 's1', 'potion', 'p9-999')).toEqual({ ok: false, error: 'unknown_target' });
    expect(buy(shop, state, 's1', 'potion', downed)).toEqual({ ok: false, error: 'target_fainted' });
    // None of those touched the shelf.
    expect(shop.stockLeft.potion).toBe(getItem('potion').stock);
  });

  it('refuses a target already at full HP rather than taking the money', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;

    expect(buy(shop, state, 's1', 'potion', id)).toEqual({ ok: false, error: 'target_full_hp' });
    expect(shop.stockLeft.potion).toBe(getItem('potion').stock);
  });

  it('refuses a buyer who cannot afford the item', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    hurt(state, id);

    expect(buy(shop, state, 's1', 'potion', id, getItem('potion').price - 1)).toEqual({ ok: false, error: 'insufficient_funds' });
    // Exactly the price is affordable.
    expect(buy(shop, state, 's1', 'potion', id, getItem('potion').price).ok).toBe(true);
  });

  it('holds the room-wide stock against many different buyers', () => {
    const state = stateFor();
    const shop = openShop(1);
    const stock = getItem('potion').stock;
    // A fresh session and a fresh target each time, so only the shelf binds.
    for (let i = 0; i < stock; i += 1) {
      const id = state.allInstanceIds[i % state.allInstanceIds.length];
      hurt(state, id, 0.2);
      expect(buy(shop, state, `session-${i}`, 'potion', id).ok).toBe(true);
    }
    const spare = state.allInstanceIds[state.allInstanceIds.length - 1];
    hurt(state, spare, 0.2);
    expect(buy(shop, state, 'session-late', 'potion', spare)).toEqual({ ok: false, error: 'out_of_stock' });
    expect(shop.stockLeft.potion).toBe(0);
    // Stock is per item, so the Super Potion shelf is untouched.
    expect(buy(shop, state, 'session-late2', 'superPotion', spare).ok).toBe(true);
  });

  it('caps one session at MATCH_ITEM_LIMIT_PER_SESSION purchases per match', () => {
    const state = stateFor();
    const shop = openShop(1);
    for (let i = 0; i < MATCH_ITEM_LIMIT_PER_SESSION; i += 1) {
      const id = state.allInstanceIds[i];
      hurt(state, id, 0.2);
      expect(buy(shop, state, 'whale', 'potion', id).ok).toBe(true);
    }
    const spare = state.allInstanceIds[MATCH_ITEM_LIMIT_PER_SESSION];
    hurt(state, spare, 0.2);
    expect(buy(shop, state, 'whale', 'potion', spare)).toEqual({ ok: false, error: 'session_limit' });
    // Somebody else is unaffected.
    expect(buy(shop, state, 'someone-else', 'potion', spare).ok).toBe(true);
  });

  it('caps heals on any one Pokémon at MAX_HEALS_PER_TARGET', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    for (let i = 0; i < MAX_HEALS_PER_TARGET; i += 1) {
      hurt(state, id, 0.2);
      expect(buy(shop, state, `session-${i}`, 'potion', id).ok).toBe(true);
    }
    hurt(state, id, 0.2);
    expect(buy(shop, state, 'session-last', 'potion', id)).toEqual({ ok: false, error: 'target_limit' });
  });

  it('is closed during the intro and once the match is complete', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    hurt(state, id);

    state.phase = 'intro';
    expect(buy(shop, state, 's1', 'potion', id)).toEqual({ ok: false, error: 'closed' });
    state.phase = 'complete';
    expect(buy(shop, state, 's1', 'potion', id)).toEqual({ ok: false, error: 'closed' });
    state.phase = 'battle';
    expect(buy(shop, state, 's1', 'potion', id).ok).toBe(true);
  });

  it('reports no_shop when there is no match running', () => {
    const state = stateFor();
    expect(buy(null, state, 's1', 'potion', state.allInstanceIds[0])).toEqual({ ok: false, error: 'no_shop' });
  });

  it('charges nothing and keeps the stock when the heal itself is refused', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    hurt(state, id);

    const result = purchaseItem(shop, state, 's1', 'potion', id, 1000, 'Tester', 1000, () => null);

    expect(result).toEqual({ ok: false, error: 'heal_failed' });
    expect(shop.stockLeft.potion).toBe(getItem('potion').stock);
    expect(shop.usesBySession.size).toBe(0);
  });
});

describe('itemUsesForSession', () => {
  it('counts only that session, and reads zero for an unknown one or no shop', () => {
    const state = stateFor();
    const shop = openShop(1);
    const [id] = state.allInstanceIds;
    hurt(state, id);
    buy(shop, state, 's1', 'potion', id);

    expect(itemUsesForSession(shop, 's1')).toBe(1);
    expect(itemUsesForSession(shop, 's2')).toBe(0);
    expect(itemUsesForSession(null, 's1')).toBe(0);
  });
});

describe('toShopSummary', () => {
  it('publishes stock and recent uses — and never a session id', () => {
    const state = stateFor();
    const shop = openShop(3);
    const [id] = state.allInstanceIds;
    hurt(state, id);
    buy(shop, state, 'secret-session-id', 'potion', id);

    const summary = toShopSummary(shop);

    expect(summary.matchNo).toBe(3);
    expect(summary.stockLeft.potion).toBe(getItem('potion').stock - 1);
    expect(summary.recent).toHaveLength(1);
    expect(JSON.stringify(summary)).not.toContain('secret-session-id');
  });

  it('sends only the tail of a long use log', () => {
    const shop = openShop(1);
    // More uses than the wire limit, pushed straight onto the log.
    for (let i = 0; i < ITEM_USE_LOG_LIMIT + 3; i += 1) {
      shop.log.push({ itemId: 'potion', targetInstanceId: 'p0-1', targetName: 'Fixmander', buyerName: `buyer-${i}`, amount: 10, atMs: i });
    }
    const summary = toShopSummary(shop);
    expect(summary.recent).toHaveLength(ITEM_USE_LOG_LIMIT);
    expect(summary.recent.at(-1)!.buyerName).toBe(`buyer-${ITEM_USE_LOG_LIMIT + 2}`);
  });
});

describe('isShopOpen', () => {
  it('is shut during the intro and after the match, open while it is fought', () => {
    const state = stateFor();
    state.phase = 'intro';
    expect(isShopOpen(state)).toBe(false);
    state.phase = 'battle';
    expect(isShopOpen(state)).toBe(true);
    state.phase = 'finalTwo';
    expect(isShopOpen(state)).toBe(true);
    state.phase = 'complete';
    expect(isShopOpen(state)).toBe(false);
  });
});
