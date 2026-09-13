import type { RoomSummary } from '../../net/protocol';

/** The landing page's headline numbers, derived from one /api/rooms poll —
 * the hero's live pill and the LIVE ROOMS header both read from here. Kept
 * pure and out of the components so it can be unit-tested under Vitest's
 * node environment, the same split shopModel.ts and predictionModel.ts use. */
export interface LiveRoomStats {
  /** Sum of every room's viewerCount. That count is SSE subscribers *plus*
   * live bots (see game-server/roomManager.ts's toRoomSummary), so this
   * includes the Featured Showcase's bot audience — which is why the hero
   * only shows it behind LandingScreen's HERO_VIEWER_TOTAL_ENABLED. */
  watching: number;
  /** Rooms whose match is being fought right now, showcase included. */
  battling: number;
  /** Every room the server lists, showcase included. */
  roomCount: number;
  /** Rooms shown in the grid — everything but the autoPlay showcase, which
   * is featured above the grid instead. */
  gridCount: number;
  /** Grid rooms currently in battle. */
  gridBattling: number;
}

export function summarizeLiveRooms(rooms: readonly RoomSummary[]): LiveRoomStats {
  let watching = 0;
  let battling = 0;
  let gridCount = 0;
  let gridBattling = 0;
  for (const room of rooms) {
    watching += room.viewerCount;
    const inBattle = room.phase === 'battle';
    if (inBattle) battling += 1;
    if (!room.autoPlay) {
      gridCount += 1;
      if (inBattle) gridBattling += 1;
    }
  }
  return { watching, battling, roomCount: rooms.length, gridCount, gridBattling };
}
