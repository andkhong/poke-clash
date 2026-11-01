import { isMobileArena } from '../../sim/constants';
import { getPlayableBounds } from '../../sim/movement';
import type { ArenaBounds } from '../../sim/types';

// The stadium's geometry, kept free of Phaser so the DOM HUD can size itself
// to the canvas without pulling the game engine into its bundle.

/** The court extends this far past the sim's playable bounds (which clamp fighter centres). */
export const COURT_MARGIN = 44;
/** The barrier wall around the court. */
export const WALL = 18;

/** How much of the arena's height the camera needs to show. The top strip of
 * stands carries the HUD's team boxes and clock, so it stays; on a wide
 * (desktop) arena, whose HUD bar sits below the canvas, the stands below the
 * court are only scenery, so the view ends a little past the court's wall. */
export function stadiumViewHeight(arena: ArenaBounds): number {
  if (isMobileArena(arena)) return arena.height;
  const courtBottom = Math.min(arena.height - WALL, getPlayableBounds(arena).maxY + COURT_MARGIN);
  return Math.min(arena.height, Math.ceil(courtBottom + WALL + 28));
}
