import type { MoveCategory, MoveDefinition } from '../../sim/types';

/** 'impact' is today's original generic VFX (colored beam-line + expanding ring,
 * see moveEffects.ts) — kept as the fallback family for status moves and anything
 * not explicitly overridden below. 'flame' is a beam sibling specific to fire
 * (see below and flameAttack.ts) — a sprayed jet of small flame sprites rather
 * than a smooth laser line, since that's a much closer match to what
 * Flamethrower/Fire Blast/etc. actually look like. 'thunder' is the same idea
 * for electric (see below and thunderAttack.ts) — a jagged, flickering bolt
 * instead of a smooth line. 'leaf' is the same sprayed-jet shape again, reused
 * for Razor Leaf (see leafAttack.ts and its override below) — leaves shot at
 * the target rather than a beam or a melee lunge. 'bubble' is the same idea
 * once more for Bubble/Bubble Beam (see bubbleAttack.ts) — a spray of round
 * bubbles instead of a smooth beam. 'wave' is the "field effect appearing at
 * the target" family (see waveAttack.ts) originally deferred when Surf was
 * pinned to 'impact' — a curling wave rather than anything traveling from the
 * attacker like every other family above. 'iceShard' is the sprayed-jet shape
 * again for ice (see below and iceShardAttack.ts) — tumbling ice crystals
 * instead of a smooth beam, glowing like flame/thunder rather than opaque
 * like leaf/bubble since crystals catch light. 'vortex' is 'wave''s field-
 * effect sibling for Hurricane (see vortexAttack.ts) — a spinning wind vortex
 * at the target instead of a wave. 'rockBurst' is 'wave'/'vortex''s field-
 * effect sibling for ground (see rockBurstAttack.ts) — rock chunks erupting
 * upward at the target instead of a wave or a vortex. 'poison' is the
 * sprayed-jet shape again for poison (see poisonAttack.ts) — tumbling sludge
 * globules instead of a smooth beam or a melee lunge; unlike every other
 * family, its particle is a real cropped sprite rather than a procedural
 * pixel grid (see that file's own comment). 'hydroPump' is 'beam''s water-
 * specific sibling (see hydroPumpAttack.ts): a real cropped water-column
 * sprite erupts at the attacker before firing, same as before, but the beam
 * itself is now that same water-column art tiled along the attacker-target
 * line rather than beamAttack.ts's flat colored line — Hydro Pump/Hydro
 * Cannon specifically, not water's whole beam-shaped movepool, get the more
 * dramatic, genuinely-water-textured treatment. */
export type MoveAnimationFamily =
  | 'beam'
  | 'lunge'
  | 'impact'
  | 'flame'
  | 'thunder'
  | 'leaf'
  | 'bubble'
  | 'wave'
  | 'iceShard'
  | 'vortex'
  | 'rockBurst'
  | 'poison'
  | 'hydroPump';

export interface MoveAnimationSpec {
  family: MoveAnimationFamily;
}

/**
 * Explicit per-move overrides for moves that shouldn't use their category's
 * (or type's — see resolveMoveAnimation) default family:
 *  - Named beam moves (the ones the reference footage was built around).
 *    Thunderbolt used to be pinned here too, back before electric had its own
 *    'thunder' family below — now it (and every other special electric move)
 *    gets that via the type-based rule instead, same as fire/flame. Hydro
 *    Pump has since moved off plain 'beam' onto its own 'hydroPump' below,
 *    which still starts from the exact same beam — see that family's own
 *    note.
 *  - Surf: 'special' category (so it'd default to 'beam'), but the reference
 *    shows its real visual is a wave appearing AT the target, not a
 *    projectile from the attacker — now has its own 'wave' family (see
 *    waveAttack.ts) instead of a beam that doesn't match its actual
 *    animation.
 *  - Hurricane: same "field effect at the target" shape as Surf, but a
 *    spinning vortex instead of a wave — now has its own 'vortex' family
 *    (see vortexAttack.ts) instead of the 'impact' fallback it used before
 *    that existed.
 *  - Razor Leaf: 'physical' category (so it'd default to 'lunge', a melee
 *    dash), but it's actually a ranged leaf-projectile move — grass has no
 *    type-based rule below (unlike fire/electric) because most special grass
 *    moves (Solar Beam, Energy Ball, ...) are genuinely beam-shaped and
 *    already read fine as plain 'beam', just tinted green — so this one named
 *    exception gets 'leaf' instead.
 *  - Bubble/Bubble Beam: both 'special' (so they'd default to 'beam'), but
 *    they're literally a spray of bubbles, not a laser — water has no
 *    type-based rule below for the same reason grass doesn't: most special
 *    water moves (Hydro Pump, Water Pulse, ...) are genuinely beam-shaped
 *    and already read fine tinted blue, so only these two named exceptions
 *    get 'bubble' instead.
 *  - Ice Shard/Icicle Spear: both 'physical' (so they'd default to 'lunge'),
 *    but both are named/depicted as ranged shard-projectile moves, the ice
 *    counterpart to Razor Leaf — see the type-based rule below for the rest
 *    of ice's special movepool.
 *  - Earthquake/Bulldoze/Precipice Blades/Thousand Arrows/Thousand Waves/
 *    Lands Wrath: all 'physical' (so they'd default to 'lunge', a melee
 *    dash+punch), but all six are "the ground itself erupts under everyone
 *    nearby" moves — genuinely 'all-enemies-in-radius' targeting, not a
 *    single punch — so they get 'rockBurst' (see the type-based rule below
 *    for ground's special movepool, which needs no such override since
 *    'beam' was never a good fit for it to begin with).
 *  - Gunk Shot: 'physical' (so it'd default to 'lunge'), but it's a thrown
 *    sludge-ball projectile, the poison counterpart to Razor Leaf/Ice
 *    Shard — see the type-based rule below for the rest of poison's special
 *    movepool.
 *  - Hydro Pump/Hydro Cannon: 'special' (so they'd default to plain 'beam',
 *    same as every other beam move), but they're water's two signature
 *    strongest beam moves and now have real cropped water-column art (see
 *    hydroPumpAttack.ts) forming the beam itself rather than a flat colored
 *    line — every other special water move (Water Pulse, Scald, Muddy
 *    Water, ...) stays on plain 'beam', just tinted blue.
 */
const MOVE_ANIMATION_OVERRIDES: Record<number, MoveAnimationFamily> = {
  58: 'beam', // Ice Beam
  56: 'hydroPump', // Hydro Pump
  308: 'hydroPump', // Hydro Cannon
  57: 'wave', // Surf
  542: 'vortex', // Hurricane
  75: 'leaf', // Razor Leaf
  145: 'bubble', // Bubble
  61: 'bubble', // Bubble Beam
  420: 'iceShard', // Ice Shard
  333: 'iceShard', // Icicle Spear
  89: 'rockBurst', // Earthquake
  523: 'rockBurst', // Bulldoze
  619: 'rockBurst', // Precipice Blades
  614: 'rockBurst', // Thousand Arrows
  615: 'rockBurst', // Thousand Waves
  616: 'rockBurst', // Lands Wrath
  441: 'poison', // Gunk Shot
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
 * moves that need to deviate from their type's default would need an
 * explicit override above. Special dragon moves (Dragon Pulse, Draco
 * Meteor, ...) reuse the same flame jet — flameAttack.ts already tints its
 * body color from the move's type (see getMoveTypeColor), so routing dragon
 * here gives a purple flame breath for free instead of needing a whole
 * separate VFX family. Special ice moves (Blizzard, Aurora Beam, Frost
 * Breath, ...) get the same treatment via 'iceShard' — Ice Beam is the one
 * exception, pinned to 'beam' above since (like Hydro Pump) it's a named
 * beam move the reference footage was built around. Special ground moves
 * (Earth Power, Mud Bomb, Mud Shot, Scorching Sands, Sandsear Storm, ...)
 * get 'rockBurst' too — unlike fire/electric/ice, 'beam' was never a
 * plausible default for these to begin with (a laser doesn't read as "earth
 * attack"), so there's no exception to carve out the way Ice Beam/Hydro Pump
 * needed one. Melee ground moves (Bone Club, Drill Run, Dig, ...) are left
 * on the plain 'lunge' default — genuine punches/kicks, not the ground
 * erupting, unlike the six spread ground moves pinned to 'rockBurst' above.
 * Special poison moves (Sludge, Sludge Bomb, Acid, Smog, Venoshock, ...) get
 * 'poison' the same way — no beam-shaped exception needed, same reasoning as
 * ground. */
export function resolveMoveAnimation(move: MoveDefinition): MoveAnimationSpec {
  if (MOVE_ANIMATION_OVERRIDES[move.id]) return { family: MOVE_ANIMATION_OVERRIDES[move.id] };
  if (move.type === 'fire' && move.category === 'special') return { family: 'flame' };
  if (move.type === 'dragon' && move.category === 'special') return { family: 'flame' };
  if (move.type === 'electric' && move.category === 'special') return { family: 'thunder' };
  if (move.type === 'ice' && move.category === 'special') return { family: 'iceShard' };
  if (move.type === 'ground' && move.category === 'special') return { family: 'rockBurst' };
  if (move.type === 'poison' && move.category === 'special') return { family: 'poison' };
  // A spread physical move with no named override above and no type-based rule
  // to catch it (Self-Destruct, Explosion, Rock Slide, Petal Blizzard, Diamond
  // Storm, Brutal Swing, Breaking Swipe, Mortal Spin, ...) would otherwise fall
  // through to the plain 'lunge' default below — but engine.ts's resolveTargets
  // can hand a spread move several real hit targets scattered around the arena,
  // and 'lunge' physically dashes the attacker to exactly ONE point (see
  // PokemonSprite.playLungeAttack). The result was the attacker visibly
  // lunging at just one of them while impact bursts (and the HP-bar drops that
  // go with them) popped up at the others' own, possibly far-off positions
  // with no attack ever visibly reaching them — reading as one attack
  // simultaneously hitting Pokémon in two different places at once. 'rockBurst'
  // is ranged and erupts independently at each hit target's own position (see
  // rockBurstAttack.ts), so — like every other spread family already routed
  // away from 'lunge' above — it's the right generic fallback for any spread
  // move that has no more specific themed family of its own.
  if (move.targeting === 'all-enemies-in-radius' && CATEGORY_DEFAULT_FAMILY[move.category] === 'lunge') {
    return { family: 'rockBurst' };
  }
  return { family: CATEGORY_DEFAULT_FAMILY[move.category] };
}
