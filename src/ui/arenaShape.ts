import type { ArenaBounds } from '../sim/types';
import { isMobileArena } from '../sim/constants';

/** How the room list and lobby name a room's arena shape (RoomSummary.arena)
 * — the same two shapes resolveMatchArena (app/config.ts) can produce. */
export function describeArenaShape(arena: ArenaBounds): { wide: boolean; label: string } {
  const wide = !isMobileArena(arena);
  return { wide, label: wide ? '🖥️ WIDE' : '📱 PORTRAIT' };
}
