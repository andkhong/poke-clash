import { describe, expect, it } from 'vitest';
import type { RoomPhase, RoomSummary } from '../../net/protocol';
import { summarizeLiveRooms } from './liveStats';

function room(id: string, phase: RoomPhase, viewerCount: number, autoPlay = false): RoomSummary {
  return {
    id,
    name: id.toUpperCase(),
    mode: 'classic',
    phase,
    slots: [],
    arena: { width: 1920, height: 1080 },
    countdownEndsAtMs: null,
    bossSpeciesName: null,
    capacity: autoPlay ? 8 : 4,
    autoPlay,
    thumbnailUpdatedAtMs: null,
    viewerCount,
  };
}

describe('summarizeLiveRooms', () => {
  it('reports all zeros for an empty room list', () => {
    expect(summarizeLiveRooms([])).toEqual({ watching: 0, battling: 0, roomCount: 0, gridCount: 0, gridBattling: 0 });
  });

  it('sums viewers and counts only battle-phase rooms as battling', () => {
    const stats = summarizeLiveRooms([
      room('a', 'idle', 0),
      room('b', 'countdown', 2),
      room('c', 'battle', 5),
      room('d', 'battle', 1),
      room('e', 'complete', 3),
    ]);
    expect(stats.watching).toBe(11);
    expect(stats.battling).toBe(2);
    expect(stats.roomCount).toBe(5);
    expect(stats.gridCount).toBe(5);
    expect(stats.gridBattling).toBe(2);
  });

  it('keeps the autoPlay showcase in the totals but out of the grid counts', () => {
    const stats = summarizeLiveRooms([room('showcase', 'battle', 12, true), room('a', 'battle', 1), room('b', 'idle', 0)]);
    expect(stats.watching).toBe(13);
    expect(stats.battling).toBe(2);
    expect(stats.roomCount).toBe(3);
    expect(stats.gridCount).toBe(2);
    expect(stats.gridBattling).toBe(1);
  });
});
