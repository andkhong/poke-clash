import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoom, joinRoom, ROOM_COUNTDOWN_MS, toRoomSummary } from './roomManager';

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

  it('splits a team-mode room into contiguous teamA/teamB halves sized by mode', () => {
    const cases: Array<['team2' | 'team3' | 'team4' | 'team8', number]> = [
      ['team2', 2],
      ['team3', 3],
      ['team4', 4],
      ['team8', 8],
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
