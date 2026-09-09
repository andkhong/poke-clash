import type { MoveCategory, MoveDefinition } from '../../sim/types';

/** 'impact' is today's original generic VFX (colored beam-line + expanding ring,
 * see moveEffects.ts) — kept as the fallback family for status moves and anything
 * not explicitly overridden below. 'flame' is a beam sibling specific to fire
 * (see below and flameAttack.ts) — a sprayed jet of small flame sprites rather
 * than a smooth laser line, since that's a much closer match to what
 * Flamethrower/Fire Blast/etc. actually look like. 'thunder' is the same idea
 * for electric (see below and thunderAttack.ts) — a jagged, flickering bolt
 * instead of a smooth line. */
export type MoveAnimationFamily = 'beam' | 'lunge' | 'impact' | 'flame' | 'thunder';

export interface MoveAnimationSpec {
  family: MoveAnimationFamily;
}

/**
 * Explicit per-move overrides for moves that shouldn't use their category's
 * (or type's — see resolveMoveAnimation) default family:
 *  - Named beam moves (the ones the reference footage was built around).
 *    Thunderbolt used to be pinned here too, back before electric had its own
 *    'thunder' family below — now it (and every other special electric move)
 *    gets that via the type-based rule instead, same as fire/flame.
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
  57: 'impact', // Surf
  542: 'impact', // Hurricane
};

const CATEGORY_DEFAULT_FAMILY: Record<MoveCategory, MoveAnimationFamily> = {
  physical: 'lunge',
  special: 'beam',
  status: 'impact',
};

/** Every move gets a family: an explicit per-move override first, then a
 * type-based rule (fire, electric, and dragon so far), then a sensible
 * default derived from its category. This is what lets a small, curated set
 * of shared VFX assets cover the whole move pool (including Struggle,
 * src/sim/struggle.ts) without hand-authoring per-move animations. Every
 * special fire move (Flamethrower, Fire Blast, Heat Wave, Lava Plume, ...)
 * automatically gets the flame treatment, and every special electric move
 * (Thunderbolt, Thunder Shock, Discharge, ...) automatically gets the
 * thunder treatment, without needing to be named individually here — only
 * moves that need to deviate from their type's default (none currently for
 * either) would need an explicit override above. Special dragon moves
 * (Dragon Pulse, Draco Meteor, ...) reuse the same flame jet — flameAttack.ts
 * already tints its body color from the move's type (see getMoveTypeColor),
 * so routing dragon here gives a purple flame breath for free instead of
 * needing a whole separate VFX family. */
export function resolveMoveAnimation(move: MoveDefinition): MoveAnimationSpec {
  if (MOVE_ANIMATION_OVERRIDES[move.id]) return { family: MOVE_ANIMATION_OVERRIDES[move.id] };
  if (move.type === 'fire' && move.category === 'special') return { family: 'flame' };
  if (move.type === 'dragon' && move.category === 'special') return { family: 'flame' };
  if (move.type === 'electric' && move.category === 'special') return { family: 'thunder' };
  return { family: CATEGORY_DEFAULT_FAMILY[move.category] };
}
