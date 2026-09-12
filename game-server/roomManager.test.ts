import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_PLAY_COUNTDOWN_MS,
  CHAT_BURST,
  CHAT_REFILL_MS,
  createRoom,
  getHelloPayload,
  joinRoom,
  MAX_THUMBNAIL_BYTES,
  pickSpecies,
  placeRoomBet,
  postChat,
  ROOM_COMPLETE_HOLD_MS,
  ROOM_COUNTDOWN_MS,
  setThumbnail,
  THUMBNAIL_MIN_INTERVAL_MS,
  toRoomSummary,
} from './roomManager';
import { broadcast, sendToSession, subscribedSessionIds } from './sse';
import { getBalance, MATCH_WATCHED_REWARD, resetWalletsForTests, touchWallet } from './wallets';
import type { PredictionSummary, WalletEventPayload } from '../src/net/protocol';
import { ROOM_MODES, roomCapacityForMode } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, CHAT_MAX_LENGTH, SPECTATOR_NAME_MAX_LENGTH } from '../src/net/chat';
import { hasPmdSprite, listAllSpecies } from '../src/data/loader';
import type { SimState } from '../src/sim/types';
import { AGGRESSION_TRIGGER_MS, ARENA_HEIGHT, ARENA_WIDTH, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH, TICK_MS } from '../src/sim/constants';
import { HUD_REFRESH_INTERVAL_MS } from '../src/ui/state/simStore';

// Broadcasting to nobody is already a no-op, but mocking lets the chat tests
// assert that a posted message actually goes out as a `chat` frame.
vi.mock('./sse', () => ({
  broadcast: vi.fn(),
  subscribe: vi.fn(),
  subscriberCount: vi.fn(() => 0),
  sendToSession: vi.fn(),
  subscribedSessionIds: vi.fn(() => new Set<string>()),
}));

describe('roomManager Team Mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Rooms started in a test leave a live sim/broadcast setInterval behind
    // (see registerRoomTickLoop) — clear it before restoring real timers so
    // it can't fire (and touch a since-torn-down fake-timer context) later.
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('gives classic/boss rooms their original 4-seat, no-team shape', () => {
    for (const mode of ['classic', 'boss'] as const) {
      const summary = toRoomSummary(createRoom(mode));
      expect(summary.capacity).toBe(4);
      expect(summary.slots).toHaveLength(4);
      expect(summary.slots.every((s) => s.team === null)).toBe(true);
    }
  });

  it('caps every room mode at 8 seats', () => {
    // The multiplayer ceiling since room chat landed: a chat feed stays
    // readable at 8 species names, and 8 human seats actually fill.
    for (const mode of ROOM_MODES) expect(roomCapacityForMode(mode)).toBeLessThanOrEqual(8);
  });

  it('splits a team-mode room into contiguous teamA/teamB halves sized by mode', () => {
    const cases: Array<['team2' | 'team3' | 'team4', number]> = [
      ['team2', 2],
      ['team3', 3],
      ['team4', 4],
    ];
    for (const [mode, teamSize] of cases) {
      const summary = toRoomSummary(createRoom(mode));
      expect(summary.capacity).toBe(teamSize * 2);
      expect(summary.slots.slice(0, teamSize).every((s) => s.team === 'teamA')).toBe(true);
      expect(summary.slots.slice(teamSize).every((s) => s.team === 'teamB')).toBe(true);
    }
  });

  it('wires a team room\'s MatchConfig.teams through to the sim, with each instance on its slot\'s side', () => {
    const room = createRoom('team2');
    for (let i = 0; i < 4; i++) {
      const result = joinRoom(room);
      expect(result.ok).toBe(true);
    }

    // Nobody picks a species in this test — startBattle's own auto-fill
    // covers that, same as an all-AFK room would hit in production.
    vi.advanceTimersByTime(ROOM_COUNTDOWN_MS);

    expect(room.phase).toBe('battle');
    const state = room.engine?.getState();
    expect(state?.teams).toEqual({ size: 2 });
    expect(state?.allInstanceIds).toHaveLength(4);
    state?.allInstanceIds.forEach((instanceId, slotIndex) => {
      expect(state.pokemon[instanceId].team).toBe(room.slots[slotIndex].team);
    });
  });
});

describe('roomManager chat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(broadcast).mockClear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function seat(room: ReturnType<typeof createRoom>): string {
    const result = joinRoom(room);
    if (!result.ok) throw new Error(result.error);
    return result.playerId;
  }

  function chatFrames() {
    return vi.mocked(broadcast).mock.calls.filter(([, event]) => event === 'chat');
  }

  it('posts a seated player\'s message with the seat snapshotted, logs it, and broadcasts it', () => {
    const room = createRoom('team2');
    const playerId = seat(room);

    const before = postChat(room, playerId, '  hello  ', 1000);
    expect(before).toEqual({
      ok: true,
      message: {
        id: 1,
        slotIndex: 0,
        speciesId: null,
        speciesName: null,
        team: 'teamA',
        spectatorName: null,
        balance: null,
        text: 'hello',
        sentAtMs: 1000,
      },
    });

    const species = listAllSpecies().find((s) => hasPmdSprite(s.id))!;
    expect(pickSpecies(room, playerId, species.id)).toEqual({ ok: true });
    const after = postChat(room, playerId, 'picked', 1100);
    expect(after.ok && after.message.speciesId).toBe(species.id);
    expect(after.ok && after.message.speciesName).toBe(species.name);

    expect(getHelloPayload(room).chatLog.map((m) => m.text)).toEqual(['hello', 'picked']);
    expect(chatFrames()).toHaveLength(2);
    expect(chatFrames()[0]).toEqual([room.id, 'chat', before.ok && before.message]);
  });

  it('refuses anyone without a seat and no spectator name to fall back to', () => {
    const room = createRoom('classic');
    const other = createRoom('classic');
    const otherPlayerId = seat(other);
    expect(postChat(room, 'nobody', 'hi')).toEqual({ ok: false, error: 'not_in_room' });
    expect(postChat(room, otherPlayerId, 'hi')).toEqual({ ok: false, error: 'not_in_room' });
    expect(chatFrames()).toHaveLength(0);
  });

  it('lets an unseated spectator chat under a generated display name', () => {
    const room = createRoom('classic');
    const result = postChat(room, null, 'hi all', 1000, 'Slowpoke482');
    expect(result).toEqual({
      ok: true,
      message: {
        id: 1,
        slotIndex: null,
        speciesId: null,
        speciesName: null,
        team: null,
        spectatorName: 'Slowpoke482',
        balance: null,
        text: 'hi all',
        sentAtMs: 1000,
      },
    });
    expect(chatFrames()).toHaveLength(1);
  });

  it('rejects a blank or over-long spectator name without logging or charging the rate limit', () => {
    const room = createRoom('classic');
    expect(postChat(room, null, 'hi', 0, '   ')).toEqual({ ok: false, error: 'invalid_name' });
    expect(postChat(room, null, 'hi', 0, 'x'.repeat(SPECTATOR_NAME_MAX_LENGTH + 1))).toEqual({ ok: false, error: 'invalid_name' });
    expect(room.chatLog).toHaveLength(0);
    // A follow-up with a valid name still gets the full burst.
    for (let i = 0; i < CHAT_BURST; i++) expect(postChat(room, null, `m${i}`, 0, 'Eevee123').ok).toBe(true);
  });

  it('rate-limits spectator chat per claimed name, independent of seated players and other names', () => {
    const room = createRoom('classic');
    const playerId = seat(room);
    const t0 = 0;
    for (let i = 0; i < CHAT_BURST; i++) expect(postChat(room, null, `a${i}`, t0, 'Eevee123').ok).toBe(true);
    expect(postChat(room, null, 'one too many', t0, 'Eevee123')).toEqual({ ok: false, error: 'rate_limited' });
    // A different spectator name and a seated player both have their own budget.
    expect(postChat(room, null, 'fresh name', t0, 'Pikachu007').ok).toBe(true);
    expect(postChat(room, playerId, 'seated', t0).ok).toBe(true);
  });

  it('rejects blank, over-long and control-only text without logging it', () => {
    const room = createRoom('classic');
    const playerId = seat(room);
    for (const text of ['', '   ', 'x'.repeat(CHAT_MAX_LENGTH + 1), String.fromCharCode(7, 10)]) {
      expect(postChat(room, playerId, text)).toEqual({ ok: false, error: 'invalid_message' });
    }
    expect(room.chatLog).toHaveLength(0);
  });

  it('assigns strictly increasing ids and keeps only the newest CHAT_LOG_LIMIT lines', () => {
    const room = createRoom('classic');
    const playerId = seat(room);
    const total = CHAT_LOG_LIMIT + 10;
    let lastId = 0;
    for (let i = 0; i < total; i++) {
      // One message per refill interval is sustainable under the rate limit.
      const result = postChat(room, playerId, `m${i}`, i * CHAT_REFILL_MS);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.message.id).toBeGreaterThan(lastId);
        lastId = result.message.id;
      }
    }
    expect(room.chatLog).toHaveLength(CHAT_LOG_LIMIT);
    expect(room.chatLog[0].text).toBe('m10');
    expect(room.chatLog[CHAT_LOG_LIMIT - 1].text).toBe(`m${total - 1}`);
  });

  it('rate-limits a seat to a burst, then one message per refill interval', () => {
    const room = createRoom('classic');
    const playerId = seat(room);
    const t0 = 10_000;

    for (let i = 0; i < CHAT_BURST; i++) expect(postChat(room, playerId, `b${i}`, t0).ok).toBe(true);
    expect(postChat(room, playerId, 'one too many', t0)).toEqual({ ok: false, error: 'rate_limited' });

    expect(postChat(room, playerId, 'after a refill', t0 + CHAT_REFILL_MS).ok).toBe(true);
    expect(postChat(room, playerId, 'still limited', t0 + CHAT_REFILL_MS)).toEqual({ ok: false, error: 'rate_limited' });

    const t1 = t0 + CHAT_REFILL_MS + CHAT_BURST * CHAT_REFILL_MS;
    for (let i = 0; i < CHAT_BURST; i++) expect(postChat(room, playerId, `c${i}`, t1).ok).toBe(true);
    expect(postChat(room, playerId, 'capped', t1)).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('does not charge the rate limit for a rejected message, and limits seats independently', () => {
    const room = createRoom('classic');
    const a = seat(room);
    const b = seat(room);
    for (let i = 0; i < CHAT_BURST + 2; i++) expect(postChat(room, a, '   ', 0).ok).toBe(false);
    for (let i = 0; i < CHAT_BURST; i++) expect(postChat(room, a, 'ok', 0).ok).toBe(true);
    expect(postChat(room, a, 'limited', 0).ok).toBe(false);
    expect(postChat(room, b, 'other seat', 0).ok).toBe(true);
  });

  it('clears the log and limits when the room resets, but keeps ids increasing', () => {
    const room = createRoom('classic');
    const playerId = seat(room);
    const first = postChat(room, playerId, 'before reset');
    expect(first.ok).toBe(true);

    vi.advanceTimersByTime(ROOM_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    room.engine!.endMatchNow();
    vi.advanceTimersByTime(TICK_MS);
    expect(room.phase).toBe('complete');
    expect(postChat(room, playerId, 'gg').ok).toBe(true); // the hold is chattable

    vi.advanceTimersByTime(ROOM_COMPLETE_HOLD_MS);
    expect(room.phase).toBe('idle');
    expect(room.chatLog).toEqual([]);
    expect(getHelloPayload(room).chatLog).toEqual([]);
    expect(postChat(room, playerId, 'stale seat')).toEqual({ ok: false, error: 'not_in_room' });

    const next = postChat(room, seat(room), 'new session');
    expect(next.ok && first.ok && next.message.id > first.message.id).toBe(true);
  });
});

describe('roomManager arena', () => {
  const portrait = { width: ARENA_WIDTH, height: ARENA_HEIGHT };
  const wide = { width: DESKTOP_ARENA_WIDTH, height: DESKTOP_ARENA_HEIGHT };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('defaults a room with no creator choice (the pre-seeded ones) to the portrait arena, and reports it in the summary', () => {
    expect(toRoomSummary(createRoom('classic')).arena).toEqual(portrait);
    expect(toRoomSummary(createRoom('classic', wide)).arena).toEqual(wide);
  });

  it("takes the session-opening joiner's arena, so a pre-seeded room can be played wide", () => {
    const room = createRoom('classic');
    expect(joinRoom(room, wide).ok).toBe(true);
    expect(toRoomSummary(room).arena).toEqual(wide);

    vi.advanceTimersByTime(ROOM_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    expect(room.engine?.getState().arena).toEqual(wide);
  });

  it('ignores the arena of anyone joining after the countdown has started, and of a join that names none', () => {
    const room = createRoom('classic', wide);
    expect(joinRoom(room).ok).toBe(true); // no choice given — keeps the creator's
    expect(toRoomSummary(room).arena).toEqual(wide);
    expect(joinRoom(room, portrait).ok).toBe(true); // second seat — too late to reshape
    expect(toRoomSummary(room).arena).toEqual(wide);
  });

  it("lets a later joiner's choice replace the creator's only by opening the session first", () => {
    const room = createRoom('classic', wide);
    expect(joinRoom(room, portrait).ok).toBe(true);
    expect(toRoomSummary(room).arena).toEqual(portrait);
  });
});

describe('roomManager autoPlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('is flagged in the summary and starts its own cycle with zero joins', () => {
    const room = createRoom('classic', undefined, { autoPlay: true });
    expect(toRoomSummary(room).autoPlay).toBe(true);
    expect(room.phase).toBe('countdown');

    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    // Every slot got a random pick — nobody ever joined to make one.
    expect(room.slots.every((s) => s.speciesId !== null && s.isAutoFilled)).toBe(true);
  });

  it('refuses a real join, seated or not', () => {
    const room = createRoom('classic', undefined, { autoPlay: true });
    expect(joinRoom(room)).toEqual({ ok: false, error: 'room_not_joinable' });
  });

  it('loops straight back into another cycle after a battle completes, instead of sitting idle', () => {
    const room = createRoom('classic', undefined, { autoPlay: true });
    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');

    room.engine!.endMatchNow();
    vi.advanceTimersByTime(TICK_MS);
    expect(room.phase).toBe('complete');

    vi.advanceTimersByTime(ROOM_COMPLETE_HOLD_MS);
    // A normal room would be idle here (see the reset test above) — this one
    // goes straight back into its next countdown.
    expect(room.phase).toBe('countdown');

    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
  });

  it('keeps its overridden seat count across resetRoom, not just its first cycle', () => {
    const room = createRoom('classic', undefined, { autoPlay: true, capacity: 6 });
    expect(room.slots).toHaveLength(6);

    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    room.engine!.endMatchNow();
    vi.advanceTimersByTime(TICK_MS);
    vi.advanceTimersByTime(ROOM_COMPLETE_HOLD_MS); // fires resetRoom, then starts the next cycle

    expect(room.slots).toHaveLength(6);
    expect(toRoomSummary(room).capacity).toBe(6);

    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    expect(room.slots.every((s) => s.speciesId !== null)).toBe(true);
  });

  it('still lets anyone — seated or spectating — chat with no seat to give', () => {
    vi.mocked(broadcast).mockClear();
    const room = createRoom('classic', undefined, { autoPlay: true });
    const result = postChat(room, null, 'nice sprite', 0, 'Bulbasaur294');
    expect(result.ok).toBe(true);
    expect(chatFrames()).toHaveLength(1);
  });

  function chatFrames() {
    return vi.mocked(broadcast).mock.calls.filter(([, event]) => event === 'chat');
  }
});

describe('roomManager thumbnails', () => {
  it('caches the first capture and reports when it landed', () => {
    const room = createRoom('classic');
    expect(room.thumbnail).toBeNull();
    expect(toRoomSummary(room).thumbnailUpdatedAtMs).toBeNull();

    const image = Buffer.from('fake-png-bytes');
    expect(setThumbnail(room, image, 1000)).toEqual({ ok: true });
    expect(room.thumbnail).toBe(image);
    expect(toRoomSummary(room).thumbnailUpdatedAtMs).toBe(1000);
  });

  it('throttles a follow-up capture that lands too soon after the last one', () => {
    const room = createRoom('classic');
    expect(setThumbnail(room, Buffer.from('a'), 1000)).toEqual({ ok: true });
    expect(setThumbnail(room, Buffer.from('b'), 1000 + THUMBNAIL_MIN_INTERVAL_MS - 1)).toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(room.thumbnail?.toString()).toBe('a'); // the throttled capture never overwrote it

    expect(setThumbnail(room, Buffer.from('c'), 1000 + THUMBNAIL_MIN_INTERVAL_MS)).toEqual({ ok: true });
    expect(room.thumbnail?.toString()).toBe('c');
  });

  it('rejects an oversized capture without caching it', () => {
    const room = createRoom('classic');
    const tooBig = Buffer.alloc(MAX_THUMBNAIL_BYTES + 1);
    expect(setThumbnail(room, tooBig, 1000)).toEqual({ ok: false, error: 'too_large' });
    expect(room.thumbnail).toBeNull();
  });
});

describe('roomManager predictions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(broadcast).mockClear();
    vi.mocked(sendToSession).mockClear();
    vi.mocked(subscribedSessionIds).mockReturnValue(new Set());
    resetWalletsForTests();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function frames(event: string) {
    return vi.mocked(broadcast).mock.calls.filter(([, e]) => e === event);
  }

  function lastPrediction(): PredictionSummary {
    const calls = frames('prediction');
    return calls[calls.length - 1][2] as PredictionSummary;
  }

  /** A room in battle, every fighter made unkillable by ordinary combat so
   * the test — not the AI's dice — decides who faints and when. */
  function battle(mode: 'classic' | 'boss' | 'team2' = 'classic') {
    const room = createRoom(mode);
    joinRoom(room, undefined, 'sess-seated');
    vi.advanceTimersByTime(ROOM_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    const state = room.engine!.getState() as SimState;
    for (const id of state.allInstanceIds) {
      state.pokemon[id].maxHp = 1_000_000_000;
      state.pokemon[id].currentHp = 1_000_000_000;
    }
    return { room, state };
  }

  /** Past the intro (faints aren't swept during it), then KO `ids` on the next sim step. */
  function knockOut(state: SimState, ids: string[]) {
    if (state.phase === 'intro') vi.advanceTimersByTime(state.introDurationMs + TICK_MS);
    for (const id of ids) state.pokemon[id].currentHp = 0;
    vi.advanceTimersByTime(TICK_MS);
  }

  it('opens a pool right after battleStart, one option per fighter, closing at the aggression mark', () => {
    const openedAt = Date.now() + ROOM_COUNTDOWN_MS;
    const { room, state } = battle();
    const events = vi.mocked(broadcast).mock.calls.map(([, e]) => e);
    expect(events.indexOf('prediction')).toBeGreaterThan(events.indexOf('battleStart'));

    const summary = lastPrediction();
    expect(summary.status).toBe('open');
    expect(summary.matchNo).toBe(1);
    expect(summary.openedAtMs).toBe(openedAt);
    expect(summary.closesAtMs).toBe(openedAt + AGGRESSION_TRIGGER_MS);
    expect(summary.options.map((o) => o.id)).toEqual(state.allInstanceIds);
    expect(summary.options.map((o) => o.label)).toEqual(state.allInstanceIds.map((id) => state.pokemon[id].name));
    expect(summary.options.every((o) => o.alive && o.total === 0 && o.bettors === 0)).toBe(true);
    expect(summary.options.reduce((sum, o) => sum + o.odds, 0)).toBeCloseTo(1, 6);
    expect(summary.pool).toBe(0);
    expect(getHelloPayload(room).prediction).toEqual(summary);
    expect(room.mode).toBe('classic');
  });

  it('debits the wallet, tops up a repeat bet, and broadcasts the pool on each bet', () => {
    const { room, state } = battle();
    touchWallet('sess-a');
    const [first, second] = state.allInstanceIds;

    const bet = placeRoomBet(room, 'sess-a', first, 30);
    expect(bet.ok && bet.balance).toBe(70);
    expect(bet.ok && bet.bet).toEqual({ optionId: first, amount: 30 });
    expect(bet.ok && bet.prediction.pool).toBe(30);

    expect(placeRoomBet(room, 'sess-a', second, 10)).toEqual({ ok: false, error: 'cannot_switch' });
    expect(placeRoomBet(room, 'sess-a', first, 71)).toEqual({ ok: false, error: 'insufficient_funds' });
    expect(placeRoomBet(room, 'sess-a', first, 0)).toEqual({ ok: false, error: 'invalid_amount' });
    expect(placeRoomBet(room, 'sess-a', 'nope', 5)).toEqual({ ok: false, error: 'unknown_option' });

    const more = placeRoomBet(room, 'sess-a', first, 20);
    expect(more.ok && more.balance).toBe(50);
    expect(more.ok && more.bet).toEqual({ optionId: first, amount: 50 });
    const option = lastPrediction().options.find((o) => o.id === first)!;
    expect(option.total).toBe(50);
    expect(option.bettors).toBe(1);
    expect(getBalance('sess-a')).toBe(50);
    expect(getHelloPayload(room, 'sess-a').me).toEqual({ balance: 50, mySlotIndex: null, myBet: { optionId: first, amount: 50 } });
  });

  it('shows a seated bettor\'s balance on their slot and re-broadcasts the room when it changes', () => {
    const { room, state } = battle();
    expect(toRoomSummary(room).slots[0].balance).toBe(100);
    vi.mocked(broadcast).mockClear();
    expect(placeRoomBet(room, 'sess-seated', state.allInstanceIds[1], 25).ok).toBe(true);
    expect(toRoomSummary(room).slots[0].balance).toBe(75);
    expect(frames('roomUpdate')).toHaveLength(1);
    expect(getHelloPayload(room, 'sess-seated').me?.mySlotIndex).toBe(0);
  });

  it('never puts a seat\'s playerId in the summary everyone receives', () => {
    const room = createRoom('classic');
    const joined = joinRoom(room, undefined, 'sess-x');
    expect(joined.ok).toBe(true);
    const json = JSON.stringify(toRoomSummary(room));
    expect(json).not.toContain(joined.ok ? joined.playerId : 'unreachable');
    expect(json).not.toContain('sess-x');
    expect(toRoomSummary(room).slots[0].occupied).toBe(true);
    expect(toRoomSummary(room).slots[1].occupied).toBe(false);
    expect(joinRoom(room, undefined, 'sess-x')).toEqual({ ok: false, error: 'already_seated' });
  });

  it('closes on the sim clock at the aggression mark and refuses later bets', () => {
    const { room, state } = battle();
    touchWallet('sess-a');
    vi.advanceTimersByTime(AGGRESSION_TRIGGER_MS - TICK_MS);
    expect(lastPrediction().status).toBe('open');
    vi.advanceTimersByTime(TICK_MS);
    expect(room.engine!.getState().elapsedMs).toBeGreaterThanOrEqual(AGGRESSION_TRIGGER_MS);
    expect(lastPrediction().status).toBe('closed');
    expect(placeRoomBet(room, 'sess-a', state.allInstanceIds[0], 10)).toEqual({ ok: false, error: 'closed' });
  });

  it('drops a fainted fighter to 0 % and locks it, on the next broadcast after the faint', () => {
    const { room, state } = battle();
    touchWallet('sess-a');
    const [victim, ...rest] = state.allInstanceIds;
    knockOut(state, [victim]);
    vi.advanceTimersByTime(HUD_REFRESH_INTERVAL_MS);
    const option = lastPrediction().options.find((o) => o.id === victim)!;
    expect(option.alive).toBe(false);
    expect(option.odds).toBe(0);
    expect(rest.map((id) => lastPrediction().options.find((o) => o.id === id)!.odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(placeRoomBet(room, 'sess-a', victim, 10)).toEqual({ ok: false, error: 'option_locked' });
    expect(placeRoomBet(room, 'sess-a', rest[0], 10).ok).toBe(true);
  });

  it('pays the pool out pro-rata to the winner\'s backers and rewards everyone watching', () => {
    const { room, state } = battle();
    touchWallet('sess-a');
    touchWallet('sess-b');
    touchWallet('sess-c');
    const [winner, loser, ...others] = state.allInstanceIds;
    expect(placeRoomBet(room, 'sess-a', winner, 30).ok).toBe(true);
    expect(placeRoomBet(room, 'sess-b', winner, 10).ok).toBe(true);
    expect(placeRoomBet(room, 'sess-c', loser, 25).ok).toBe(true);
    vi.mocked(subscribedSessionIds).mockReturnValue(new Set(['sess-a', 'sess-c', 'sess-watcher']));
    touchWallet('sess-watcher');

    knockOut(state, [loser, ...others]);
    expect(room.phase).toBe('complete');

    const settled = lastPrediction();
    expect(settled.status).toBe('settled');
    expect(settled.winnerOptionId).toBe(winner);
    expect(settled.refunded).toBe(false);
    expect(settled.options.find((o) => o.id === winner)!.odds).toBe(1);
    // Pool 65, winning stakes 40: a gets floor(65*30/40)=48, b floor(65*10/40)=16.
    expect(getBalance('sess-a')).toBe(70 + 48 + MATCH_WATCHED_REWARD);
    expect(getBalance('sess-b')).toBe(90 + 16);
    expect(getBalance('sess-c')).toBe(75 + MATCH_WATCHED_REWARD);
    expect(getBalance('sess-watcher')).toBe(100 + MATCH_WATCHED_REWARD);

    const wallets = vi.mocked(sendToSession).mock.calls.filter(([, event]) => event === 'wallet');
    expect(wallets.map(([sessionId]) => sessionId).sort()).toEqual(['sess-a', 'sess-b', 'sess-c', 'sess-watcher']);
    const forA = wallets.find(([sessionId]) => sessionId === 'sess-a')![2] as WalletEventPayload;
    expect(forA).toEqual({ balance: 128, myBet: null, settled: { matchNo: 1, staked: 30, returned: 48, watched: MATCH_WATCHED_REWARD } });
    const forB = wallets.find(([sessionId]) => sessionId === 'sess-b')![2] as WalletEventPayload;
    expect(forB.settled).toEqual({ matchNo: 1, staked: 10, returned: 16, watched: 0 });
    // The slot list goes out again with the seated player's new balance.
    expect(frames('roomUpdate').length).toBeGreaterThan(0);
  });

  it('refunds every stake when the match ends with co-winners', () => {
    const { room, state } = battle();
    touchWallet('sess-a');
    touchWallet('sess-b');
    const [x, y] = state.allInstanceIds;
    expect(placeRoomBet(room, 'sess-a', x, 40).ok).toBe(true);
    expect(placeRoomBet(room, 'sess-b', y, 15).ok).toBe(true);

    room.engine!.endMatchNow(); // everyone still standing shares the win
    vi.advanceTimersByTime(TICK_MS);
    expect(room.phase).toBe('complete');

    const settled = lastPrediction();
    expect(settled.status).toBe('settled');
    expect(settled.winnerOptionId).toBeNull();
    expect(settled.refunded).toBe(true);
    expect(getBalance('sess-a')).toBe(100);
    expect(getBalance('sess-b')).toBe(100);
  });

  it('settles a match that ends before the window would have closed', () => {
    const { room, state } = battle();
    const [winner, ...rest] = state.allInstanceIds;
    knockOut(state, rest);
    expect(room.phase).toBe('complete');
    expect(lastPrediction().status).toBe('settled');
    expect(lastPrediction().winnerOptionId).toBe(winner);
  });

  it('resolves a whole side in boss and team rooms', () => {
    const boss = battle('boss');
    const bossId = boss.state.allInstanceIds.find((id) => id.startsWith('boss-'))!;
    expect(lastPrediction().options.map((o) => o.id)).toEqual(['party', 'boss']);
    expect(lastPrediction().options[1].label).toBe(`Boss · ${boss.state.pokemon[bossId].name}`);
    knockOut(boss.state, boss.state.allInstanceIds.filter((id) => id !== bossId));
    expect(lastPrediction().winnerOptionId).toBe('boss');

    vi.mocked(broadcast).mockClear();
    const team = battle('team2');
    expect(lastPrediction().options.map((o) => ({ id: o.id, label: o.label, n: o.instanceIds.length }))).toEqual([
      { id: 'teamA', label: 'Team A', n: 2 },
      { id: 'teamB', label: 'Team B', n: 2 },
    ]);
    knockOut(team.state, team.state.allInstanceIds.filter((id) => team.state.pokemon[id].team === 'teamA'));
    expect(team.room.phase).toBe('complete');
    expect(lastPrediction().winnerOptionId).toBe('teamB');
  });

  it('drops the pool with the engine at reset but keeps wallets, and numbers the next match', () => {
    const { room } = battle();
    touchWallet('sess-a');
    expect(placeRoomBet(room, 'sess-a', lastPrediction().options[0].id, 10).ok).toBe(true);
    room.engine!.endMatchNow();
    vi.advanceTimersByTime(TICK_MS + ROOM_COMPLETE_HOLD_MS);
    expect(room.phase).toBe('idle');
    expect(room.prediction).toBeNull();
    expect(getHelloPayload(room, 'sess-a')).toMatchObject({ prediction: null, me: { balance: 100, mySlotIndex: null, myBet: null } });
    expect(placeRoomBet(room, 'sess-a', 'anything', 10)).toEqual({ ok: false, error: 'no_prediction' });

    joinRoom(room, undefined, 'sess-b');
    vi.advanceTimersByTime(ROOM_COUNTDOWN_MS);
    expect(lastPrediction().matchNo).toBe(2);
  });

  it('keeps the showcase room at its 8-seat override and reopens a pool every cycle', () => {
    const room = createRoom('classic', undefined, { autoPlay: true, capacity: 8 });
    vi.advanceTimersByTime(AUTO_PLAY_COUNTDOWN_MS);
    expect(lastPrediction().options).toHaveLength(8);
    room.engine!.endMatchNow();
    vi.advanceTimersByTime(TICK_MS + ROOM_COMPLETE_HOLD_MS + AUTO_PLAY_COUNTDOWN_MS);
    expect(room.phase).toBe('battle');
    expect(lastPrediction()).toMatchObject({ matchNo: 2, status: 'open' });
    expect(lastPrediction().options).toHaveLength(8);
  });
});
