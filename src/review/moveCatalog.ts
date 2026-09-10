import movesData from '../data/generated/moves.json';
import moveAnimationIndexData from '../data/generated/moveAnimations.json';
import moveSoundIndexData from '../data/generated/moveSounds.json';
import type { MoveAnimationIndex, MoveAnimationIndexEntry, MoveSoundIndex } from '../data/types';
import type { MoveDefinition } from '../sim/types';
import { STRUGGLE_MOVE } from '../sim/struggle';
import { resolveMoveAnimation, type MoveAnimationFamily } from '../render/vfx/moveAnimations';

// The move list the review page (src/review/) browses: every move the arena
// can play, each with the answer to "what does the arena actually draw for
// this?". Pure data, no Phaser, so it can be unit-tested and built once at
// page load.

/** Where a move's on-screen effect comes from in the arena — the same
 * decision ArenaScene.handleMoveUsed makes: the Gen 9 Move Animation
 * Project's animation whenever the pack has one that isn't screen-wide, the
 * arena's own family VFX (src/render/vfx/moves/) otherwise. Computed from
 * the bundled index alone; keep in step with that method. */
export type AnimationSource =
  | { kind: 'pack'; entry: MoveAnimationIndexEntry }
  | {
      kind: 'family';
      family: MoveAnimationFamily;
      /** Why the pack animation isn't used: the pack has none for this move,
       * or the one it has is a screen-wide effect (see
       * MoveAnimationIndexEntry.screen). */
      reason: 'no-pack-animation' | 'screen-wide';
      entry: MoveAnimationIndexEntry | null;
    };

export interface ReviewMove {
  move: MoveDefinition;
  source: AnimationSource;
  /** True when moveSounds.json has a clip for the move (see render/sound/moveSound.ts). */
  hasSound: boolean;
}

const MOVE_ANIMATION_INDEX = moveAnimationIndexData as MoveAnimationIndex;
const MOVE_SOUND_INDEX = moveSoundIndexData as MoveSoundIndex;

export function resolveAnimationSource(move: MoveDefinition): AnimationSource {
  const entry = MOVE_ANIMATION_INDEX.moves[String(move.id)];
  if (entry && !entry.screen) return { kind: 'pack', entry };
  return {
    kind: 'family',
    family: resolveMoveAnimation(move).family,
    reason: entry ? 'screen-wide' : 'no-pack-animation',
    entry: entry ?? null,
  };
}

/** Every move the arena can play — the dataset's moves plus Struggle — with
 * its animation source, sorted by name. */
export function buildMoveCatalog(): ReviewMove[] {
  const moves = [...Object.values(movesData as Record<string, MoveDefinition>), STRUGGLE_MOVE];
  return moves
    .map((move) => ({
      move,
      source: resolveAnimationSource(move),
      hasSound: Boolean(MOVE_SOUND_INDEX[String(move.id)]),
    }))
    .sort((a, b) => a.move.name.localeCompare(b.move.name));
}

/** One-line label for an export table: `pack Move:THUNDERBOLT` or `arena thunder`. */
export function describeSource(source: AnimationSource): string {
  return source.kind === 'pack' ? `pack ${source.entry.anim}` : `arena ${source.family}`;
}
