import type { MoveAnimationIndexEntry } from '../../data/types';
import type { MoveDefinition } from '../../sim/types';
import { resolveMoveAnimation, type MoveAnimationFamily } from './moveAnimations';
import type { MoveVfxAdjustment } from './moveVfxAdjustments';

// The one decision of what the arena draws for a move: the Gen 9 Move
// Animation Project's animation, or one of the arena's own family effects
// (src/render/vfx/moves/). Shared by ArenaScene (a match), the review
// page's stage and its move list so all three always agree. Pure: the
// index entry and the review's per-move tuning are passed in.

export type MoveVfxSource =
  | {
      kind: 'pack';
      entry: MoveAnimationIndexEntry;
      /** True when the review pinned a pack animation the arena would
       * otherwise skip (see MoveVfxAdjustment.usePackAnimation). */
      viaReview: boolean;
    }
  | {
      kind: 'family';
      family: MoveAnimationFamily;
      /** Why the pack animation isn't used: the pack has none for this
       * move; the one it has is a screen-wide effect (see
       * MoveAnimationIndexEntry.screen); the review preferred the arena's
       * effect (MoveVfxAdjustment.preferArenaVfx); or the caller forced it. */
      reason: 'no-pack-animation' | 'screen-wide' | 'review-preference' | 'forced';
      entry: MoveAnimationIndexEntry | null;
    };

export function resolveMoveVfxSource(
  move: MoveDefinition,
  entry: MoveAnimationIndexEntry | undefined,
  adjustment: MoveVfxAdjustment | undefined,
  /** Override the decision: 'pack' plays the pack animation wherever one
   * exists (even screen-wide), 'arena' the family effect — the review
   * page's "with / without the assets" comparison. */
  force?: 'pack' | 'arena'
): MoveVfxSource {
  const familySource = (reason: Extract<MoveVfxSource, { kind: 'family' }>['reason']): MoveVfxSource => ({
    kind: 'family',
    family: resolveMoveAnimation(move).family,
    reason,
    entry: entry ?? null,
  });
  if (!entry) return familySource('no-pack-animation');
  if (force === 'pack') return { kind: 'pack', entry, viaReview: false };
  if (force === 'arena') return familySource('forced');
  if (adjustment?.usePackAnimation) return { kind: 'pack', entry, viaReview: true };
  if (adjustment?.preferArenaVfx) return familySource('review-preference');
  if (entry.screen) return familySource('screen-wide');
  return { kind: 'pack', entry, viaReview: false };
}
