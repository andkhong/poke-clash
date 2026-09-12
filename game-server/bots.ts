import type { MatchPhase, SimEvent } from '../src/sim/types';
import type { PredictionStatus, RoomPhase } from '../src/net/protocol';
import { createRng, rngInt, rngIntInclusive, rngPick, rngChance, type Rng } from '../src/sim/rng';
import { normalizeSpectatorName, QUICK_REACTIONS } from '../src/net/chat';
import { getItem, MAX_HEALS_PER_TARGET, type ItemId } from '../src/net/shop';

/** Bot spectators for the always-on showcase room — the fake audience that
 * keeps it from reading as a ghost town before anyone arrives. They chat,
 * bet and buy shop items, and everything they do goes out through the same
 * postChat/placeRoomBet/purchaseRoomItem the real UI calls, so a bot line is
 * indistinguishable from a spectator's on the wire.
 *
 * Sibling of predictions.ts and shop.ts, and the same division of labour:
 * this module owns a mutable state object and every rule about what a bot
 * would plausibly do; roomManager owns the timer, the wallets, the SSE and
 * the actual calls. Nothing here imports roomManager, sse or wallets, and
 * every decision takes an injected rng and clock, so the whole thing unit
 * tests without a room or an engine.
 *
 * One deliberate divergence from those two siblings: a PredictionState and a
 * ShopState are per-match and dropped by resetRoom, but a BotState outlives
 * the match. The audience has to still be there during the countdown, and
 * the viewer count it feeds must not blink to zero between rounds.
 *
 * On fairness, since bots bet real money against real viewers: a parimutuel
 * pool is zero-sum among its bettors, so bots betting semi-randomly are, on
 * average, a transfer *to* whoever reads the match better. They make pools
 * deeper and payouts larger without making them harder to win. What bots
 * must never do is take the shop out from under a human, which is what
 * BOT_STOCK_RESERVE below is for.
 */

/** How often roomManager runs a tick. Everything below is paced in real
 * milliseconds against it rather than in ticks, so the cadence survives the
 * interval being retuned. */
export const BOT_TICK_MS = 1_000;

/** Roster bounds. The showcase room already has real viewers — every visitor
 * sitting on the landing page holds a stream open to it (FeaturedRoomPanel
 * embeds a live RoomScreen) — so this is padding an existing count, not
 * inventing one. Small enough to stay plausible once real traffic lands on
 * top of it. */
export const MIN_BOTS = 4;
export const MAX_BOTS = 9;

/** Shortest gap between two bot chat lines, room-wide (a jitter is added on
 * top). Deliberately room-wide rather than per-bot: what matters is how fast
 * the log scrolls, not how often any one of them talks. */
export const BOT_CHAT_MIN_GAP_MS = 4_500;

/** How much longer the gap gets when there is nobody watching. Bots still
 * talk, so an arriving viewer finds a backlog in the hello replay rather than
 * an empty room — just slowly enough not to churn CHAT_LOG_LIMIT. */
export const BOT_CHAT_IDLE_MULTIPLIER = 4;

/** After a real person says something, bots hold off this long. A room that
 * talks over its actual viewers is worse than a quiet one. */
export const BOT_CHAT_HUMAN_FREEZE_MS = 8_000;

/** Bot lines per match, counting the system line every purchase emits. Caps
 * how much of the 50-message log bots can own. */
export const BOT_CHAT_MAX_PER_MATCH = 16;

/** Shortest gap between two bot purchases, room-wide. Every purchase also
 * writes a system chat line (roomManager's purchaseRoomItem), so buys are the
 * loudest thing bots do. */
export const BOT_BUY_MIN_GAP_MS = 6_000;

/** Units of each item bots will not touch — the shelf as it stood before it
 * was widened to make room for them (see src/net/shop.ts). Bots consume only
 * the increase, so a real viewer can never find the shop cleared out by them.
 * This is the whole reason raising stock is safe. */
export const BOT_STOCK_RESERVE: Record<ItemId, number> = { potion: 3, superPotion: 1 };

/** Chance a given bot bets at all in a given match, and buys at all. The buy
 * rate can be generous because BOT_STOCK_RESERVE, not restraint, is what
 * keeps the shelf available to real viewers. */
export const BOT_BET_CHANCE = 0.65;
export const BOT_BUY_CHANCE = 0.45;

/** Latest a planned bet may fire. The pool closes on the sim clock at
 * AGGRESSION_TRIGGER_MS (45 s); this leaves margin for a tick landing late. */
export const BOT_BET_LATEST_ELAPSED_MS = 40_000;

/** Bots get no MATCH_WATCHED_REWARD — that is paid to open streams, and a bot
 * has none — so their balances are floored each match. They are also capped,
 * because balances are rendered beside names in chat and "Slowpoke42 ($4,120)"
 * reads as exactly what it is. */
export const BOT_BALANCE_FLOOR = 100;
export const BOT_BALANCE_CEILING = 500;

/** A bot's target's HP must be at or below this for it to be worth healing,
 * and at or below the second for a Super Potion to be the sensible pick. */
const BOT_BUY_HP_THRESHOLD = 0.6;
const BOT_SUPER_POTION_HP_THRESHOLD = 0.3;

/** How long a bot sticks around before churning out, and how often the roster
 * re-picks the size it is drifting toward. */
const BOT_LIFETIME_MIN_MS = 3 * 60_000;
const BOT_LIFETIME_MAX_MS = 12 * 60_000;
const ROSTER_RESIZE_INTERVAL_MS = 2 * 60_000;

/** How many recent lines are remembered to steer away from repeats. */
const RECENT_TEMPLATE_MEMORY = 8;

interface Bot {
  /** "Slowpoke42" — the same shape src/net/spectatorIdentity.ts mints for a
   * real tab, but with a two-digit suffix where a real one has three. That
   * keeps the two namespaces disjoint, which matters twice: a collision would
   * make a real viewer see "(You)" on a bot's line, and would put them in the
   * same `spectator:<name>` chat rate-limit bucket. */
  name: string;
  /** `bot-<hex>`; satisfies isValidSessionId and cannot collide with a
   * client-minted id, which is a bare UUID. */
  sessionId: string;
  leaveAtMs: number;
  /** Decided once at battle start and never revised — a bot that changed its
   * mind would be refused with `cannot_switch` (see predictions.ts). */
  betPlan: { optionId: string; amount: number; atElapsedMs: number } | null;
  hasBet: boolean;
  buyAtElapsedMs: number | null;
  hasBought: boolean;
}

export interface BotState {
  rng: Rng;
  bots: Bot[];
  /** Session ids of the live roster, for isBotSession's hot path. */
  sessionIds: Set<string>;
  speciesNames: readonly string[];
  targetSize: number;
  nextResizeAtMs: number;
  nextChatAtMs: number;
  /** When the last line actually went out — the floor a reaction may jump
   * ahead to, distinct from the (longer, jittered) nextChatAtMs. */
  lastChatAtMs: number;
  nextBuyAtMs: number;
  chatLinesThisMatch: number;
  /** This module's own cursor into the engine's event log, deliberately
   * separate from RoomState.lastBroadcastSeq so reading events for reactions
   * can never disturb what the 10 Hz broadcast has sent. */
  eventCursor: number;
  /** The most recent thing worth reacting to, consumed by the next line. */
  pendingReaction: { category: ReactionCategory; name: string | null } | null;
  /** The last few templates used, so the same line doesn't come round twice
   * in a minute. Real chat repeats itself; this much repeats less. */
  recentTemplates: string[];
}

export interface BotTarget {
  instanceId: string;
  name: string;
  hpFraction: number;
  /** Fainted fighters stay in the list so a reaction can still name the one
   * that just went down — they are simply never healed. */
  alive: boolean;
}

/** Everything a tick needs to know about the room, assembled by roomManager.
 * Nullable wherever the room legitimately has nothing: between matches there
 * is no engine, no pool and no shop, but bots still chat. */
export interface BotContext {
  roomPhase: RoomPhase;
  simPhase: MatchPhase | null;
  elapsedMs: number | null;
  /** Real SSE subscribers — never includes bots. */
  humanViewerCount: number;
  /** Since a real person last posted, or null if none has this match. */
  msSinceHumanChat: number | null;
  prediction: {
    status: PredictionStatus;
    options: readonly { id: string; alive: boolean; odds: number }[];
  } | null;
  shop: {
    stockLeft: Record<ItemId, number>;
    healsByTarget: ReadonlyMap<string, number>;
  } | null;
  /** Every fighter in the match, living or not (see BotTarget.alive). */
  targets: readonly BotTarget[];
  /** Engine events since state.eventCursor. */
  events: readonly SimEvent[];
  /** Bot session id -> balance. */
  balances: ReadonlyMap<string, number>;
}

export type BotAction =
  | { kind: 'chat'; sessionId: string; name: string; text: string }
  | { kind: 'bet'; sessionId: string; name: string; optionId: string; amount: number }
  | { kind: 'buy'; sessionId: string; name: string; itemId: ItemId; targetInstanceId: string };

export interface BotTickResult {
  actions: BotAction[];
  /** Session ids that joined / left the roster this tick — roomManager pairs
   * these with walletStreamOpened/walletStreamClosed. */
  joined: string[];
  left: string[];
}

type ReactionCategory = 'crit' | 'superEffective' | 'fainted' | 'finalTwo' | 'matchEnd' | 'shop';

/** What bots say. Written rather than generated, because the only thing that
 * makes a canned line read as alive is that it is about what just happened —
 * hence the `{name}` slots, filled from the live fighter list.
 *
 * Every string here is asserted to survive normalizeChatText and the language
 * filter (see bots.test.ts): chatFilter.ts matches leetspeak and separators,
 * so an innocent line tripping it is plausible, and a rejected line would
 * make a bot silently mute. */
const LINES: Record<string, readonly string[]> = {
  lobby: [
    'who are we backing this round',
    'next one starting soon',
    'i need a win this time',
    'lets goooo',
    'back again',
    'my wallet is not ok',
    'new round new me',
    'ok this time im calling it',
    'anyone else broke',
    'first',
    'been watching this all morning',
    'give me something good',
    'last round was unreal',
    'ok one more then im done',
    'whos in',
  ],
  matchStart: [
    'here we go',
    'ok lock in',
    'this lineup is stacked',
    'oh this is a good one',
    'lets see it',
    'money is down',
    '{name} looks scary',
  ],
  crit: ['OOF', 'that crit hurt', 'brutal', 'ouch', 'not the crit', 'come on', 'critical, of course'],
  superEffective: ['thats gotta hurt', 'cooked', 'super effective, ouch', 'melted', 'yikes', 'no chance'],
  fainted: [
    'rip {name}',
    'F',
    '{name} is down',
    'gg {name}',
    'nooo {name}',
    'there goes my bet',
    'well that was quick',
    'knew it',
    'one down',
  ],
  finalTwo: ['final two', 'ok this is it', '1v1 now', 'so close', 'dont choke', 'my heart', 'come onnn'],
  matchEnd: [
    'gg',
    'called it',
    'ggs everyone',
    'wow',
    'i knew it',
    'robbed',
    'never betting again',
    'that was a good one',
    'rematch',
  ],
  betting: [
    'all in',
    'easy money',
    'i never win these',
    'the odds are lying',
    'trust me on this one',
    'putting everything on {name}',
    'the favourite never wins here',
    'locked in',
    'this is free money',
    'betting against the odds again',
    'someone talk me out of this',
    '{name} is underrated',
  ],
  shop: ['someone heal that thing', 'potion time', 'worth every dollar', 'save {name}'],
  filler: [
    ...QUICK_REACTIONS,
    'lol',
    'nice',
    'wild',
    'yep',
    'oh?',
    'this is a good round',
    'go on then',
    '{name} is cooking',
    'wait what',
    'not looking good for {name}',
    'here we go again',
    'this is close',
    'someone do something',
  ],
};

/** Every pool, for the language-filter test to walk. */
export const BOT_LINE_POOLS: Readonly<Record<string, readonly string[]>> = LINES;

function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T | null {
  let total = 0;
  for (const item of items) total += Math.max(0, weight(item));
  if (total <= 0) return items.length > 0 ? rngPick(rng, items) : null;
  let roll = rng() * total;
  for (const item of items) {
    roll -= Math.max(0, weight(item));
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/** A bot session id, derived from the rng so a seeded BotState replays
 * identically — randomUUID would make every test run different. */
function makeSessionId(rng: Rng): string {
  let hex = '';
  for (let i = 0; i < 8; i += 1) hex += rngInt(rng, 0, 16).toString(16);
  return `bot-${hex}`;
}

/** Species whose names survive being used as a display name: letters only, so
 * "Farfetch'd", "Mr. Mime", "Type: Null" and "Porygon-Z" stay out, and the
 * result reads exactly like a real tab's generated name. */
export function botNamePool(speciesNames: readonly string[]): string[] {
  return speciesNames.filter((name) => /^[A-Za-z]{3,16}$/.test(name));
}

function makeBot(state: BotState, nowMs: number): Bot | null {
  const taken = new Set(state.bots.map((bot) => bot.name));
  // Bounded rather than a while(true): a pool of hundreds against a roster of
  // at most MAX_BOTS makes a collision rare, and giving up for one tick is a
  // perfectly good outcome.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const species = rngPick(state.rng, state.speciesNames);
    const name = `${species}${rngIntInclusive(state.rng, 10, 99)}`;
    // A name the server would refuse (normalizeSpectatorName runs the
    // name-strict language filter) would leave this bot permanently mute with
    // no signal, so it is checked here, once, instead.
    if (taken.has(name) || normalizeSpectatorName(name) !== name) continue;
    return {
      name,
      sessionId: makeSessionId(state.rng),
      leaveAtMs: nowMs + rngIntInclusive(state.rng, BOT_LIFETIME_MIN_MS, BOT_LIFETIME_MAX_MS),
      betPlan: null,
      hasBet: false,
      buyAtElapsedMs: null,
      hasBought: false,
    };
  }
  return null;
}

export function createBotState(seed: number, nowMs: number, speciesNames: readonly string[]): BotState {
  const rng = createRng(seed);
  const pool = botNamePool(speciesNames);
  const state: BotState = {
    rng,
    bots: [],
    sessionIds: new Set(),
    speciesNames: pool,
    targetSize: rngIntInclusive(rng, MIN_BOTS, MAX_BOTS),
    nextResizeAtMs: nowMs + ROSTER_RESIZE_INTERVAL_MS,
    nextChatAtMs: nowMs,
    lastChatAtMs: nowMs - BOT_CHAT_MIN_GAP_MS,
    nextBuyAtMs: nowMs,
    chatLinesThisMatch: 0,
    eventCursor: 0,
    pendingReaction: null,
    recentTemplates: [],
  };
  // Seeded full rather than trickled in: the room is live from boot and a
  // count that climbs from zero on every server restart is a worse lie than
  // one that is simply there.
  for (let i = 0; i < state.targetSize; i += 1) {
    const bot = makeBot(state, nowMs);
    if (!bot) break;
    state.bots.push(bot);
    state.sessionIds.add(bot.sessionId);
  }
  return state;
}

export function liveBotCount(state: BotState | null): number {
  return state?.bots.length ?? 0;
}

export function isBotSession(state: BotState | null, sessionId: string | null | undefined): boolean {
  return sessionId !== null && sessionId !== undefined && (state?.sessionIds.has(sessionId) ?? false);
}

export function botSessionIds(state: BotState): string[] {
  return state.bots.map((bot) => bot.sessionId);
}

/** Rolls each bot's intentions for the match that just started. Called from
 * startBattle, once the pool and shelf exist. */
export function startBotMatch(state: BotState, ctx: BotContext, nowMs: number): void {
  state.chatLinesThisMatch = 0;
  state.pendingReaction = null;
  state.nextChatAtMs = nowMs + rngIntInclusive(state.rng, 1_000, 4_000);
  state.lastChatAtMs = nowMs - BOT_CHAT_MIN_GAP_MS;
  state.nextBuyAtMs = nowMs;

  const options = ctx.prediction?.options.filter((option) => option.alive) ?? [];
  for (const bot of state.bots) {
    bot.hasBet = false;
    bot.hasBought = false;
    bot.betPlan = null;
    bot.buyAtElapsedMs = null;

    if (options.length > 0 && rngChance(state.rng, BOT_BET_CHANCE)) {
      // Weighted toward the favourites, the way real money moves. The 0.5
      // floor keeps a longshot bettable rather than mathematically ignored.
      const option = weightedPick(state.rng, options, (candidate) => 0.5 + candidate.odds);
      if (option) {
        const balance = ctx.balances.get(bot.sessionId) ?? 0;
        const allIn = rngChance(state.rng, 0.05);
        const amount = allIn ? balance : 5 * rngIntInclusive(state.rng, 2, 10);
        // rng()**1.7 front-loads the window: most money is down early, a few
        // stragglers trickle in before the pool closes.
        const atElapsedMs = 1_500 + Math.floor(state.rng() ** 1.7 * 36_000);
        bot.betPlan = { optionId: option.id, amount, atElapsedMs };
      }
    }

    if (rngChance(state.rng, BOT_BUY_CHANCE)) {
      // When the bot *starts looking*, not when it fires: an armed plan waits
      // for someone worth rescuing (see planBuy). It is well inside the
      // window because a showcase match with eight fighters usually ends
      // around a minute, far short of MATCH_TIME_LIMIT_MS — a plan timed for
      // the back half would simply never come up.
      bot.buyAtElapsedMs = rngIntInclusive(state.rng, 6_000, 35_000);
    }
  }
}

/** Clears the per-match planning without touching the roster — resetRoom's
 * counterpart to startBotMatch. The roster itself deliberately survives (see
 * the module header), the same carve-out RoomState.nextChatId has. */
export function resetBotMatch(state: BotState, nowMs: number): void {
  state.chatLinesThisMatch = 0;
  state.pendingReaction = null;
  state.eventCursor = 0;
  state.nextChatAtMs = nowMs + rngIntInclusive(state.rng, 1_000, 5_000);
  for (const bot of state.bots) {
    bot.betPlan = null;
    bot.hasBet = false;
    bot.buyAtElapsedMs = null;
    bot.hasBought = false;
  }
}

function churn(state: BotState, nowMs: number, result: BotTickResult): void {
  for (let i = state.bots.length - 1; i >= 0; i -= 1) {
    const bot = state.bots[i];
    // Never below MIN_BOTS: an expired bot outstays its welcome rather than
    // let the room visibly empty out.
    if (bot.leaveAtMs > nowMs || state.bots.length <= MIN_BOTS) continue;
    state.bots.splice(i, 1);
    state.sessionIds.delete(bot.sessionId);
    result.left.push(bot.sessionId);
  }

  if (nowMs >= state.nextResizeAtMs) {
    state.targetSize = rngIntInclusive(state.rng, MIN_BOTS, MAX_BOTS);
    state.nextResizeAtMs = nowMs + ROSTER_RESIZE_INTERVAL_MS;
  }

  // One arrival at a time, and not on every tick — a roster that refills
  // instantly never appears to move.
  if (state.bots.length < state.targetSize && rngChance(state.rng, 0.15)) {
    const bot = makeBot(state, nowMs);
    if (bot) {
      state.bots.push(bot);
      state.sessionIds.add(bot.sessionId);
      result.joined.push(bot.sessionId);
    }
  }
}

/** Reads the tick's events for the one thing most worth talking about. Later
 * events win: by the time a line goes out, the freshest reaction is the only
 * one that still makes sense. */
function noteReaction(state: BotState, ctx: BotContext): void {
  const nameOf = (instanceId: string): string | null =>
    ctx.targets.find((target) => target.instanceId === instanceId)?.name ?? null;

  for (const event of ctx.events) {
    if (event.seq > state.eventCursor) state.eventCursor = event.seq;
    switch (event.type) {
      case 'fainted':
        state.pendingReaction = { category: 'fainted', name: nameOf(event.instanceId) };
        break;
      case 'itemUsed':
        state.pendingReaction = { category: 'shop', name: nameOf(event.instanceId) };
        break;
      case 'milestone':
        if (event.kind === 'finalTwo') state.pendingReaction = { category: 'finalTwo', name: null };
        else if (event.kind === 'matchEnd') state.pendingReaction = { category: 'matchEnd', name: null };
        break;
      case 'moveUsed': {
        const critId = Object.keys(event.crit).find((id) => event.crit[id]);
        if (critId) {
          state.pendingReaction = { category: 'crit', name: nameOf(critId) };
          break;
        }
        const superId = Object.keys(event.effectiveness).find((id) => event.effectiveness[id] > 1);
        if (superId) state.pendingReaction = { category: 'superEffective', name: nameOf(superId) };
        break;
      }
      default:
        break;
    }
  }
}

function chatGapMs(state: BotState, ctx: BotContext): number {
  const base = BOT_CHAT_MIN_GAP_MS + rngInt(state.rng, 0, 9_000);
  // Nobody watching: keep a plausible backlog for whoever arrives next, and
  // otherwise stay out of the way of CHAT_LOG_LIMIT.
  return ctx.humanViewerCount === 0 ? base * BOT_CHAT_IDLE_MULTIPLIER : base;
}

function nextLine(state: BotState, ctx: BotContext): string | null {
  const reaction = state.pendingReaction;
  state.pendingReaction = null;

  let pool: readonly string[];
  let name: string | null = null;
  if (reaction) {
    pool = LINES[reaction.category];
    name = reaction.name;
  } else if (ctx.roomPhase === 'idle' || ctx.roomPhase === 'countdown') {
    pool = LINES.lobby;
  } else if (ctx.prediction?.status === 'open') {
    pool = state.rng() < 0.4 ? LINES.betting : LINES.filler;
  } else if (ctx.simPhase === 'intro') {
    pool = LINES.matchStart;
  } else {
    pool = LINES.filler;
  }

  // Re-roll a template that was used recently. Bounded, and it falls through
  // to a repeat rather than looping: a pool smaller than the memory would
  // otherwise have nothing left to say.
  let template = rngPick(state.rng, pool);
  for (let attempt = 0; attempt < 4 && state.recentTemplates.includes(template); attempt += 1) {
    template = rngPick(state.rng, pool);
  }
  state.recentTemplates.push(template);
  if (state.recentTemplates.length > RECENT_TEMPLATE_MEMORY) state.recentTemplates.shift();

  if (!template.includes('{name}')) return template;
  // A line that needs a fighter and has none to name would go out as a
  // literal "{name}" — fall back rather than say something broken.
  const living = ctx.targets.filter((target) => target.alive);
  const filler = name ?? (living.length > 0 ? rngPick(state.rng, living).name : null);
  if (filler === null) return null;
  return template.replace('{name}', filler);
}

function planChat(state: BotState, ctx: BotContext, nowMs: number): BotAction | null {
  if (state.bots.length === 0) return null;
  if (state.chatLinesThisMatch >= BOT_CHAT_MAX_PER_MATCH) return null;
  // Yield the floor: a room that talks over its actual viewers is worse than
  // a quiet one.
  if (ctx.msSinceHumanChat !== null && ctx.msSinceHumanChat < BOT_CHAT_HUMAN_FREEZE_MS) return null;
  // A reaction jumps the queue — nobody waits ten seconds to say "rip" — but
  // never past the room-wide floor, which is what actually paces the log.
  const due = state.pendingReaction !== null ? state.lastChatAtMs + BOT_CHAT_MIN_GAP_MS : state.nextChatAtMs;
  if (nowMs < due) return null;

  const text = nextLine(state, ctx);
  if (text === null) return null;

  state.lastChatAtMs = nowMs;
  state.nextChatAtMs = nowMs + chatGapMs(state, ctx);
  state.chatLinesThisMatch += 1;
  const bot = rngPick(state.rng, state.bots);
  return { kind: 'chat', sessionId: bot.sessionId, name: bot.name, text };
}

function planBet(state: BotState, ctx: BotContext): BotAction | null {
  const prediction = ctx.prediction;
  if (!prediction || prediction.status !== 'open') return null;
  if (ctx.elapsedMs === null || ctx.elapsedMs > BOT_BET_LATEST_ELAPSED_MS) return null;

  for (const bot of state.bots) {
    const plan = bot.betPlan;
    if (!plan || bot.hasBet || ctx.elapsedMs < plan.atElapsedMs) continue;
    // Re-checked at fire time, not just at plan time: the pick can faint in
    // between, and placeBet would refuse with option_locked.
    if (!prediction.options.some((option) => option.id === plan.optionId && option.alive)) {
      bot.hasBet = true;
      continue;
    }
    const balance = ctx.balances.get(bot.sessionId) ?? 0;
    const amount = Math.min(plan.amount, balance);
    // Marked spent either way — a bot that cannot afford its plan drops it
    // rather than retrying every tick for the rest of the match.
    bot.hasBet = true;
    if (amount < 1) continue;
    return { kind: 'bet', sessionId: bot.sessionId, name: bot.name, optionId: plan.optionId, amount };
  }
  return null;
}

function planBuy(state: BotState, ctx: BotContext, nowMs: number): BotAction | null {
  const shop = ctx.shop;
  if (!shop || ctx.elapsedMs === null) return null;
  if (ctx.simPhase === null || ctx.simPhase === 'intro' || ctx.simPhase === 'complete') return null;
  if (nowMs < state.nextBuyAtMs) return null;

  for (const bot of state.bots) {
    if (bot.hasBought || bot.buyAtElapsedMs === null || ctx.elapsedMs < bot.buyAtElapsedMs) continue;

    const candidates = ctx.targets.filter(
      (target) =>
        target.alive &&
        target.hpFraction > 0 &&
        target.hpFraction <= BOT_BUY_HP_THRESHOLD &&
        (shop.healsByTarget.get(target.instanceId) ?? 0) < MAX_HEALS_PER_TARGET
    );
    // Nobody worth healing yet — leave the plan armed and look again next
    // tick rather than burning the bot's one purchase on a full-HP target.
    if (candidates.length === 0) return null;

    const target = weightedPick(state.rng, candidates, (candidate) => (1 - candidate.hpFraction) ** 2);
    if (!target) return null;

    // Stock first, then what this bot can pay for — a Super Potion when the
    // target is in real trouble, otherwise a Potion, and either as a fallback
    // when the other is down to its reserve.
    const superAvailable = affordableStock(shop, 'superPotion');
    const potionAvailable = affordableStock(shop, 'potion');
    // Neither is buyable by anyone, so no other bot will fare better either.
    if (!superAvailable && !potionAvailable) return null;

    const balance = ctx.balances.get(bot.sessionId) ?? 0;
    const canSuper = superAvailable && balance >= getItem('superPotion').price;
    const canPotion = potionAvailable && balance >= getItem('potion').price;
    const wantsSuper = target.hpFraction <= BOT_SUPER_POTION_HP_THRESHOLD;
    const itemId: ItemId | null =
      wantsSuper && canSuper ? 'superPotion' : canPotion ? 'potion' : canSuper ? 'superPotion' : null;
    if (itemId === null) {
      // This bot is simply too poor for what's left; the next one may not be.
      bot.hasBought = true;
      continue;
    }

    bot.hasBought = true;
    state.nextBuyAtMs = nowMs + BOT_BUY_MIN_GAP_MS;
    // Purchases announce themselves in chat, so they come out of the same
    // budget the lines do.
    state.chatLinesThisMatch += 1;
    return { kind: 'buy', sessionId: bot.sessionId, name: bot.name, itemId, targetInstanceId: target.instanceId };
  }
  return null;
}

/** Whether bots may take a unit of this item without eating into the shelf
 * held for real viewers (see BOT_STOCK_RESERVE). */
function affordableStock(shop: NonNullable<BotContext['shop']>, itemId: ItemId): boolean {
  return (shop.stockLeft[itemId] ?? 0) - BOT_STOCK_RESERVE[itemId] > 0;
}

/** One tick. Emits at most one action of each kind, which is what keeps a
 * burst of simultaneously-due bots from firing four SSE frames in the same
 * second — the loser of a tie simply goes next tick, invisible at 1 Hz. */
export function tickBots(state: BotState, ctx: BotContext, nowMs: number): BotTickResult {
  const result: BotTickResult = { actions: [], joined: [], left: [] };
  churn(state, nowMs, result);
  noteReaction(state, ctx);

  const chat = planChat(state, ctx, nowMs);
  if (chat) result.actions.push(chat);
  const bet = planBet(state, ctx);
  if (bet) result.actions.push(bet);
  const buy = planBuy(state, ctx, nowMs);
  if (buy) result.actions.push(buy);

  return result;
}
