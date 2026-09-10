import movesData from '../data/generated/moves.json';
import moveAnimationIndexData from '../data/generated/moveAnimations.json';
import moveSoundIndexData from '../data/generated/moveSounds.json';
import type { MoveAnimationIndex, MoveAnimationIndexEntry, MoveSoundIndex } from '../data/types';
import type { MoveDefinition } from '../sim/types';
import { STRUGGLE_MOVE } from '../sim/struggle';
import { getMoveVfxAdjustment } from '../render/vfx/moveVfxAdjustments';
import { resolveMoveVfxSource, type MoveVfxSource } from '../render/vfx/moveVfxSource';

// The move list the review page (src/review/) browses: every move the arena
// can play, each with the answer to "what does the arena actually draw for
// this?". Pure data, no Phaser, so it can be unit-tested and built once at
// page load.

/** Where a move's on-screen effect comes from in the arena — the same
 * decision a match makes (see render/vfx/moveVfxSource.ts), computed here
 * from the bundled index alone so the catalog needs no Phaser scene. */
export type AnimationSource = MoveVfxSource;

export interface ReviewMove {
  move: MoveDefinition;
  source: AnimationSource;
  /** True when moveSounds.json has a clip for the move (see render/sound/moveSound.ts). */
  hasSound: boolean;
  /** The other way this move could be drawn, when the arena's default
   * would skip a pack animation the pack ships (screen-wide, or set aside
   * by the review) or plays one only because the review asked: the pack
   * animation for a family source, the family effect for a review-pinned
   * pack — the "unused assets" comparison. Null for an ordinary pack move. */
  alternative: AnimationSource | null;
}

const MOVE_ANIMATION_INDEX = moveAnimationIndexData as MoveAnimationIndex;
const MOVE_SOUND_INDEX = moveSoundIndexData as MoveSoundIndex;

export function resolveAnimationSource(move: MoveDefinition): AnimationSource {
  return resolveMoveVfxSource(move, MOVE_ANIMATION_INDEX.moves[String(move.id)], getMoveVfxAdjustment(move.id));
}

function resolveAlternative(move: MoveDefinition, source: AnimationSource): AnimationSource | null {
  const entry: MoveAnimationIndexEntry | undefined = MOVE_ANIMATION_INDEX.moves[String(move.id)];
  const adjustment = getMoveVfxAdjustment(move.id);
  if (source.kind === 'family') return source.entry ? resolveMoveVfxSource(move, entry, adjustment, 'pack') : null;
  return source.viaReview || source.entry.screen ? resolveMoveVfxSource(move, entry, adjustment, 'arena') : null;
}

/** Every move the arena can play — the dataset's moves plus Struggle — with
 * its animation source, sorted by name. */
export function buildMoveCatalog(): ReviewMove[] {
  const moves = [...Object.values(movesData as Record<string, MoveDefinition>), STRUGGLE_MOVE];
  return moves
    .map((move) => {
      const source = resolveAnimationSource(move);
      return {
        move,
        source,
        hasSound: Boolean(MOVE_SOUND_INDEX[String(move.id)]),
        alternative: resolveAlternative(move, source),
      };
    })
    .sort((a, b) => a.move.name.localeCompare(b.move.name));
}

/** One-line label for an export table: `pack Move:THUNDERBOLT` or `arena thunder`. */
export function describeSource(source: AnimationSource): string {
  return source.kind === 'pack' ? `pack ${source.entry.anim}` : `arena ${source.family}`;
}
