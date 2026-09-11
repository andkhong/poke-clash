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
  postChat,
  ROOM_COMPLETE_HOLD_MS,
  ROOM_COUNTDOWN_MS,
  setThumbnail,
  THUMBNAIL_MIN_INTERVAL_MS,
  toRoomSummary,
} from './roomManager';
import { broadcast } from './sse';
import { ROOM_MODES, roomCapacityForMode } from '../src/net/protocol';
import { CHAT_LOG_LIMIT, CHAT_MAX_LENGTH, SPECTATOR_NAME_MAX_LENGTH } from '../src/net/chat';
import { hasPmdSprite, listAllSpecies } from '../src/data/loader';
import { ARENA_HEIGHT, ARENA_WIDTH, DESKTOP_ARENA_HEIGHT, DESKTOP_ARENA_WIDTH, TICK_MS } from '../src/sim/constants';

// Broadcasting to nobody is already a no-op, but mocking lets the chat tests
// assert that a posted message actually goes out as a `chat` frame.
vi.mock('./sse', () => ({ broadcast: vi.fn(), subscribe: vi.fn(), subscriberCount: vi.fn(() => 0) }));

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
