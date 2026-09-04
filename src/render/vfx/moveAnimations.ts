import type { MoveCategory, MoveDefinition } from '../../sim/types';

/** 'impact' is today's original generic VFX (colored beam-line + expanding ring,
 * see moveEffects.ts) — kept as the fallback family for status moves and anything
 * not explicitly overridden below. */
export type MoveAnimationFamily = 'beam' | 'lunge' | 'impact';

export interface MoveAnimationSpec {
  family: MoveAnimationFamily;
}

/**
 * Explicit per-move overrides for moves that shouldn't use their category's
 * default family. Two kinds of entries live here:
 *  - Named beam moves (the ones the reference footage was built around).
 *  - Surf/Hurricane: both 'special' category (so they'd default to 'beam'), but
 *    the reference shows their real visual is an effect appearing AT the target
 *    (a wave block / swirl), not a projectile from the attacker — a genuine
 *    third "field effect" family is out of scope for this pass, so they're
 *    pinned to 'impact' (today's generic look) instead of a beam that doesn't
 *    match their actual animation.
 */
const MOVE_ANIMATION_OVERRIDES: Record<number, MoveAnimationFamily> = {
  58: 'beam', // Ice Beam
  56: 'beam', // Hydro Pump
  85: 'beam', // Thunderbolt
  53: 'beam', // Flamethrower
  57: 'impact', // Surf
  542: 'impact', // Hurricane
};

const CATEGORY_DEFAULT_FAMILY: Record<MoveCategory, MoveAnimationFamily> = {
  physical: 'lunge',
  special: 'beam',
  status: 'impact',
};

/** Every move gets a family: an explicit override if one exists, otherwise a
 * sensible default derived from its category. This is what lets a small,
 * curated set of shared VFX assets cover the whole move pool (including
 * Struggle, src/sim/struggle.ts) without hand-authoring per-move animations. */
export function resolveMoveAnimation(move: MoveDefinition): MoveAnimationSpec {
  return { family: MOVE_ANIMATION_OVERRIDES[move.id] ?? CATEGORY_DEFAULT_FAMILY[move.category] };
}
