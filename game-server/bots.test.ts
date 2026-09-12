import { describe, expect, it } from 'vitest';
import {
  BOT_BET_LATEST_ELAPSED_MS,
  BOT_CHAT_HUMAN_FREEZE_MS,
  BOT_CHAT_MAX_PER_MATCH,
  BOT_CHAT_MIN_GAP_MS,
  BOT_LINE_POOLS,
  BOT_STOCK_RESERVE,
  BOT_TICK_MS,
  MAX_BOTS,
  MIN_BOTS,
  botNamePool,
  botSessionIds,
  createBotState,
  isBotSession,
  liveBotCount,
  resetBotMatch,
  startBotMatch,
  tickBots,
  type BotAction,
  type BotContext,
  type BotState,
} from './bots';
import { normalizeChatText, normalizeSpectatorName } from '../src/net/chat';
import { containsBlockedLanguage } from '../src/net/chatFilter';
import { isValidSessionId } from '../src/net/predictions';
import { MAX_HEALS_PER_TARGET, getItem, isValidInstanceId } from '../src/net/shop';
import { listAllSpecies } from '../src/data/loader';
import type { SimEvent } from '../src/sim/types';

const SPECIES_NAMES = listAllSpecies().map((s) => s.name);

/** A mid-battle room with a live pool, a full shelf and four hurt fighters —
 * the shape most rules below are about. Overridden per test. */
function ctxWith(overrides: Partial<BotContext> = {}): BotContext {
  return {
    roomPhase: 'battle',
    simPhase: 'battle',
    elapsedMs: 10_000,
    humanViewerCount: 0,
    msSinceHumanChat: null,
    prediction: {
      status: 'open',
      options: [
        { id: 'p0-1', alive: true, odds: 0.5 },
        { id: 'p1-2', alive: true, odds: 0.3 },
        { id: 'p2-3', alive: true, odds: 0.2 },
      ],
    },
    shop: {
      stockLeft: { potion: getItem('potion').stock, superPotion: getItem('superPotion').stock },
      healsByTarget: new Map(),
    },
    targets: [
      { instanceId: 'p0-1', name: 'Piplup', hpFraction: 0.4, alive: true },
      { instanceId: 'p1-2', name: 'Gengar', hpFraction: 0.2, alive: true },
      { instanceId: 'p2-3', name: 'Snorlax', hpFraction: 0.9, alive: true },
    ],
    events: [],
    balances: new Map(),
    ...overrides,
  };
}

function fund(state: BotState, amount = 500): Map<string, number> {
  return new Map(botSessionIds(state).map((id) => [id, amount]));
}

/** Runs `ticks` of the clock, returning everything the roster did. */
function run(
  state: BotState,
  ticks: number,
  build: (tick: number, nowMs: number) => BotContext,
  startAtMs = 0
): { actions: BotAction[]; joined: string[]; left: string[] } {
  const all: BotAction[] = [];
  const joined: string[] = [];
  const left: string[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    const nowMs = startAtMs + tick * BOT_TICK_MS;
    const result = tickBots(state, build(tick, nowMs), nowMs);
    all.push(...result.actions);
    joined.push(...result.joined);
    left.push(...result.left);
  }
  return { actions: all, joined, left };
}

describe('bot roster', () => {
  it('seeds a full roster of plausible spectator identities', () => {
    const state = createBotState(11, 0, SPECIES_NAMES);
    expect(liveBotCount(state)).toBeGreaterThanOrEqual(MIN_BOTS);
    expect(liveBotCount(state)).toBeLessThanOrEqual(MAX_BOTS);
    expect(new Set(botSessionIds(state)).size).toBe(liveBotCount(state));
  });

  it('gives every bot a name the server would actually accept', () => {
    // A name normalizeSpectatorName refuses would make that bot silently mute
    // for its whole life, so generation checks rather than hopes.
    for (let seed = 0; seed < 40; seed += 1) {
      const state = createBotState(seed, 0, SPECIES_NAMES);
      for (const bot of state.bots) {
        expect(normalizeSpectatorName(bot.name)).toBe(bot.name);
        expect(isValidSessionId(bot.sessionId)).toBe(true);
      }
      expect(new Set(state.bots.map((b) => b.name)).size).toBe(state.bots.length);
    }
  });

  it('keeps bot names out of the space real tabs generate', () => {
    // spectatorIdentity.ts always appends three digits; bots always two, so
    // a collision can never make a real viewer see "(You)" on a bot's line or
    // share their `spectator:<name>` rate-limit bucket.
    const state = createBotState(3, 0, SPECIES_NAMES);
    for (const bot of state.bots) expect(bot.name).toMatch(/^[A-Za-z]+\d{2}$/);
  });

  it('skips species whose names would not read as a display name', () => {
    const pool = botNamePool(["Farfetch'd", 'Mr. Mime', 'Type: Null', 'Porygon-Z', 'Piplup']);
    expect(pool).toEqual(['Piplup']);
  });

  it('identifies its own sessions and nobody else', () => {
    const state = createBotState(5, 0, SPECIES_NAMES);
    expect(isBotSession(state, botSessionIds(state)[0])).toBe(true);
    expect(isBotSession(state, 'some-real-tab')).toBe(false);
    expect(isBotSession(null, 'anything')).toBe(false);
    expect(isBotSession(state, null)).toBe(false);
  });

  it('churns without ever leaking a session — every departure was a live bot', () => {
    const state = createBotState(9, 0, SPECIES_NAMES);
    const live = new Set(botSessionIds(state));
    const { joined, left } = run(state, 3_000, () => ctxWith({ roomPhase: 'idle', simPhase: null, elapsedMs: null }));

    // The wallet invariant: roomManager opens one stream per `joined` and
    // closes one per `left`, so a `left` id that was never live (or leaves
    // twice) would strand a wallet forever.
    for (const id of joined) {
      expect(live.has(id)).toBe(false);
      live.add(id);
    }
    for (const id of left) {
      expect(live.has(id)).toBe(true);
      live.delete(id);
    }
    expect(new Set(botSessionIds(state))).toEqual(live);
    expect(liveBotCount(state)).toBeGreaterThanOrEqual(MIN_BOTS);
    expect(liveBotCount(state)).toBeLessThanOrEqual(MAX_BOTS);
    expect(joined.length).toBeGreaterThan(0); // the roster really did move
  });
});

describe('bot chat', () => {
  it('never sends a line the language filter would reject', () => {
    // chatFilter matches leetspeak, separators and repeats, so an innocent
    // line tripping it is plausible — and a rejected line is a mute bot.
    for (const [pool, lines] of Object.entries(BOT_LINE_POOLS)) {
      for (const line of lines) {
        const filled = line.replace('{name}', 'Piplup');
        expect(normalizeChatText(filled), `${pool}: ${line}`).toBe(filled);
        expect(containsBlockedLanguage(filled), `${pool}: ${line}`).toBe(false);
      }
    }
  });

  it('never fills a {name} slot with the literal placeholder', () => {
    const state = createBotState(2, 0, SPECIES_NAMES);
    const { actions } = run(state, 600, () => ctxWith({ humanViewerCount: 3 }));
    const chats = actions.filter((a) => a.kind === 'chat');
    expect(chats.length).toBeGreaterThan(0);
    for (const chat of chats) expect(chat.text).not.toContain('{name}');
  });

  it('leaves at least the room-wide gap between lines', () => {
    const state = createBotState(4, 0, SPECIES_NAMES);
    let lastAtMs: number | null = null;
    for (let tick = 0; tick < 600; tick += 1) {
      const nowMs = tick * BOT_TICK_MS;
      const { actions } = tickBots(state, ctxWith({ humanViewerCount: 2 }), nowMs);
      if (!actions.some((a) => a.kind === 'chat')) continue;
      if (lastAtMs !== null) expect(nowMs - lastAtMs).toBeGreaterThanOrEqual(BOT_CHAT_MIN_GAP_MS);
      lastAtMs = nowMs;
    }
  });

  it('yields the floor while a real person is still talking', () => {
    const state = createBotState(6, 0, SPECIES_NAMES);
    const { actions } = run(state, 300, () =>
      ctxWith({ humanViewerCount: 2, msSinceHumanChat: BOT_CHAT_HUMAN_FREEZE_MS - 1 })
    );
    expect(actions.filter((a) => a.kind === 'chat')).toHaveLength(0);
  });

  it('gets quieter with nobody watching than with an audience', () => {
    const watched = createBotState(8, 0, SPECIES_NAMES);
    const empty = createBotState(8, 0, SPECIES_NAMES);
    const count = (state: BotState, humanViewerCount: number) =>
      run(state, 400, () => ctxWith({ humanViewerCount })).actions.filter((a) => a.kind === 'chat').length;
    expect(count(watched, 3)).toBeGreaterThan(count(empty, 0));
  });

  it('caps how much of the chat log one match can be bots', () => {
    const state = createBotState(12, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const { actions } = run(state, 2_000, () => ctxWith({ humanViewerCount: 4, balances: fund(state) }));
    // Purchases announce themselves in chat, so they count against the budget.
    const chatty = actions.filter((a) => a.kind === 'chat' || a.kind === 'buy');
    expect(chatty.length).toBeLessThanOrEqual(BOT_CHAT_MAX_PER_MATCH);
  });

  it('reacts to what just happened rather than talking past it', () => {
    const state = createBotState(14, 0, SPECIES_NAMES);
    const fainted: SimEvent = { seq: 1, atMs: 1, type: 'fainted', instanceId: 'p1-2', byInstanceId: 'p0-1' };
    // Gengar is dead by the time anyone reacts, which is exactly why targets
    // keep fainted fighters: naming it is the whole point of the line.
    const dead = ctxWith().targets.map((t) => (t.instanceId === 'p1-2' ? { ...t, alive: false, hpFraction: 0 } : t));
    const { actions } = run(state, 40, (tick) =>
      ctxWith({ humanViewerCount: 2, targets: dead, events: tick === 0 ? [fainted] : [] })
    );
    const chats = actions.filter((a) => a.kind === 'chat');
    expect(chats.length).toBeGreaterThan(0);
    // The first thing said after the faint comes from the faint pool, not
    // whatever the phase would otherwise have picked.
    const faintLines = BOT_LINE_POOLS.fainted.map((line) => line.replace('{name}', 'Gengar'));
    expect(faintLines).toContain(chats[0].kind === 'chat' ? chats[0].text : '');
  });
});

describe('bot betting', () => {
  it('never bets twice, and never switches option', () => {
    const state = createBotState(21, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const { actions } = run(state, 60, (tick) =>
      ctxWith({ elapsedMs: tick * BOT_TICK_MS, balances: fund(state) })
    );
    const bets = actions.filter((a) => a.kind === 'bet');
    expect(bets.length).toBeGreaterThan(0);
    // placeBet refuses a second option outright (`cannot_switch`), so one
    // bet per bot per match is a hard requirement, not a preference.
    expect(new Set(bets.map((b) => b.sessionId)).size).toBe(bets.length);
  });

  it('spreads the pool out instead of firing everything at once', () => {
    const state = createBotState(22, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const perTick = new Map<number, number>();
    for (let tick = 0; tick < 60; tick += 1) {
      const nowMs = tick * BOT_TICK_MS;
      const { actions } = tickBots(state, ctxWith({ elapsedMs: nowMs, balances: fund(state) }), nowMs);
      const bets = actions.filter((a) => a.kind === 'bet').length;
      if (bets > 0) perTick.set(tick, bets);
    }
    expect(perTick.size).toBeGreaterThan(1);
    for (const count of perTick.values()) expect(count).toBe(1);
  });

  it('stops once the pool closes, and never bets past the deadline', () => {
    const state = createBotState(23, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const late = run(state, 60, (tick) =>
      ctxWith({ elapsedMs: BOT_BET_LATEST_ELAPSED_MS + 1_000 + tick, balances: fund(state) })
    );
    expect(late.actions.filter((a) => a.kind === 'bet')).toHaveLength(0);

    const closed = run(state, 60, (tick) =>
      ctxWith({
        elapsedMs: tick * BOT_TICK_MS,
        balances: fund(state),
        prediction: { status: 'closed', options: ctxWith().prediction!.options },
      })
    );
    expect(closed.actions.filter((a) => a.kind === 'bet')).toHaveLength(0);
  });

  it('abandons a pick that faints before its bet lands', () => {
    const state = createBotState(24, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const deadOptions = ctxWith().prediction!.options.map((o) => ({ ...o, alive: false }));
    const { actions } = run(state, 60, (tick) =>
      ctxWith({
        elapsedMs: tick * BOT_TICK_MS,
        balances: fund(state),
        prediction: { status: 'open', options: deadOptions },
      })
    );
    expect(actions.filter((a) => a.kind === 'bet')).toHaveLength(0);
  });

  it('never stakes more than the bot actually has', () => {
    const state = createBotState(25, 0, SPECIES_NAMES);
    const broke = new Map(botSessionIds(state).map((id) => [id, 12]));
    startBotMatch(state, ctxWith({ balances: broke }), 0);
    const { actions } = run(state, 60, (tick) => ctxWith({ elapsedMs: tick * BOT_TICK_MS, balances: broke }));
    for (const action of actions) {
      if (action.kind === 'bet') expect(action.amount).toBeLessThanOrEqual(12);
    }
  });

  it('places nothing at all with no pool open', () => {
    const state = createBotState(26, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const { actions } = run(state, 60, () =>
      ctxWith({ roomPhase: 'idle', simPhase: null, elapsedMs: null, prediction: null, shop: null })
    );
    expect(actions.filter((a) => a.kind !== 'chat')).toHaveLength(0);
  });
});

describe('bot buying', () => {
  it('never takes the shelf below the reserve held for real viewers', () => {
    const state = createBotState(31, 0, SPECIES_NAMES);
    const stockLeft = { potion: getItem('potion').stock, superPotion: getItem('superPotion').stock };
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    // Ten matches' worth of chances, with the shelf draining as they land.
    for (let round = 0; round < 10; round += 1) {
      resetBotMatch(state, round * 200_000);
      startBotMatch(state, ctxWith({ balances: fund(state) }), round * 200_000);
      for (let tick = 0; tick < 120; tick += 1) {
        const nowMs = round * 200_000 + tick * BOT_TICK_MS;
        const { actions } = tickBots(
          state,
          ctxWith({ elapsedMs: tick * BOT_TICK_MS, balances: fund(state), shop: { stockLeft, healsByTarget: new Map() } }),
          nowMs
        );
        for (const action of actions) if (action.kind === 'buy') stockLeft[action.itemId] -= 1;
      }
    }
    expect(stockLeft.potion).toBeGreaterThanOrEqual(BOT_STOCK_RESERVE.potion);
    expect(stockLeft.superPotion).toBeGreaterThanOrEqual(BOT_STOCK_RESERVE.superPotion);
  });

  it('heals someone who is actually hurt, and never one already at the cap', () => {
    const state = createBotState(32, 0, SPECIES_NAMES);
    const healsByTarget = new Map([['p1-2', MAX_HEALS_PER_TARGET]]);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const { actions } = run(state, 200, (tick) =>
      ctxWith({
        elapsedMs: tick * BOT_TICK_MS,
        balances: fund(state),
        shop: { stockLeft: { potion: 8, superPotion: 3 }, healsByTarget },
      })
    );
    const buys = actions.filter((a) => a.kind === 'buy');
    expect(buys.length).toBeGreaterThan(0);
    for (const buy of buys) {
      expect(isValidInstanceId(buy.targetInstanceId)).toBe(true);
      expect(buy.targetInstanceId).not.toBe('p1-2'); // maxed out
      expect(buy.targetInstanceId).not.toBe('p2-3'); // at 90% HP, not worth it
    }
  });

  it('buys nothing during the intro parade or after the match', () => {
    const state = createBotState(33, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    for (const simPhase of ['intro', 'complete'] as const) {
      const { actions } = run(state, 200, (tick) =>
        ctxWith({ simPhase, elapsedMs: tick * BOT_TICK_MS, balances: fund(state) })
      );
      expect(actions.filter((a) => a.kind === 'buy')).toHaveLength(0);
    }
  });

  it('buys at most once per bot per match', () => {
    const state = createBotState(34, 0, SPECIES_NAMES);
    startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
    const { actions } = run(state, 400, (tick) =>
      ctxWith({ elapsedMs: tick * BOT_TICK_MS, balances: fund(state), shop: { stockLeft: { potion: 99, superPotion: 99 }, healsByTarget: new Map() } })
    );
    const buys = actions.filter((a) => a.kind === 'buy');
    expect(new Set(buys.map((b) => b.sessionId)).size).toBe(buys.length);
  });
});

describe('bot determinism', () => {
  it('replays identically from the same seed', () => {
    const play = () => {
      const state = createBotState(77, 0, SPECIES_NAMES);
      startBotMatch(state, ctxWith({ balances: fund(state) }), 0);
      return run(state, 300, (tick) =>
        ctxWith({ elapsedMs: tick * BOT_TICK_MS, humanViewerCount: 2, balances: fund(state) })
      ).actions;
    };
    expect(play()).toEqual(play());
  });
});
