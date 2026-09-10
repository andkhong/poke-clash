// Per-move tuning of the arena's move VFX on top of what the pack ships —
// the outcome of reviews on /review.html (see vfx-review/). Anything not
// listed plays untouched. Each entry cites the review note it answers so a
// later reviewer can tell why it exists. The review page can play a move
// with these switched off to show the "before".

import type { PatternCycle } from './anim/AnimPlayer';
import type { ScreenAnchor } from './anim/geometry';

export interface MoveVfxAdjustment {
  /** Play the arena's own family VFX (src/render/vfx/moves/) instead of the
   * pack's animation, as if the pack had none — see resolveMoveVfxSource. */
  preferArenaVfx?: boolean;
  /** Play the pack's animation even though the arena would skip it (a
   * screen-wide one, see MoveAnimationIndexEntry.screen) — the reviewer
   * preferred the assets to the arena's own effect. */
  usePackAnimation?: boolean;
  /** Multiplier on the pack animation's size (its cells and their spread). */
  scale?: number;
  /** Nudge (canonical px, before scaling) added to every cell of the pack
   * animation: negative y lifts it. */
  offset?: { x?: number; y?: number };
  /** Cells of the pack animation to leave out, by their authored canonical
   * position. */
  dropCells?: readonly { x: number; y: number }[];
  /** Sheet cells (pattern indices, row-major) of the pack animation never
   * to draw — the kanji captions some animations end on. */
  dropPatterns?: readonly number[];
  /** Pins a screen-wide animation's screen-focused cells on one battler,
   * with the canonical point `center` landing on it — see geometry.ts's
   * ScreenAnchor. */
  screenAnchor?: ScreenAnchor;
  /** Keeps the pack animation's authored orientation whatever direction
   * the attacker faces: its battler-anchored cells sit at their authored
   * offset from the battler and nothing turns with the attacker->target
   * direction (see geometry.ts's AnimTransform.upright) — for face art
   * drawn to be looked at, which the rotation spins or hangs upside down. */
  upright?: boolean;
  /** Steps every drawn cell of the pack animation through a sequence of
   * its sheet's cells instead of the one it was authored with (see
   * AnimPlayer.ts's PatternCycle) — for an animation that draws a single
   * cell of a sheet holding a whole sequence. */
  patternCycle?: PatternCycle;
  /** Playback speed in a match as a multiple of the pack's native 20 fps,
   * replacing the arena's default (AnimPlayer.ts's ATTACK_PLAYBACK_SPEED,
   * 2×); the animation is still compressed to fit the attack window. */
  playbackSpeed?: number;
  /** Where the arena's own family effect anchors on the fighters, overriding
   * the family's default (see playFamilyVfx.ts's familyAnchorsAtBodyCenter). */
  familyAnchor?: 'center' | 'feet';
}

// "Use assets" below is the reviewer's pick on the review page's Unused
// assets list: the pack's screen-wide animation over the arena's own
// family effect. Screen-focused cells spread along the line between the
// fighters; most of these animations author their action at the pack's
// target spot, so they land on the target without further help.
export const MOVE_VFX_ADJUSTMENTS: Readonly<Record<number, MoveVfxAdjustment>> = {
  // Growl — review: use assets (sound waves across the field).
  45: { usePackAnimation: true },
  // Blizzard — review: "Sprite is a little wide. Shrink it by 10%".
  59: { scale: 0.9 },
  // Aurora Beam — review: "Beam could be bigger".
  62: { scale: 1.35 },
  // Thunderbolt plays the pack's animation: the review first asked for the
  // arena's jagged bolt ("Reuse the previous thunder VFX for this move"),
  // then picked "Use the assets" on the Unused assets list. A
  // `preferArenaVfx: true` entry brings the bolt (moves/thunderAttack.ts) back.
  // Earthquake — review: use assets (the pack's rocks all over the screen).
  89: { usePackAnimation: true },
  // Dig — review: "There is an extra dig sprite to the left of the target.
  // It needs to be removed". The pack draws a second mound at the user's
  // screen spot but anchors it on the target, so the arena dragged it in
  // beside the target.
  91: { dropCells: [{ x: 128, y: 282 }] },
  // Confusion — review: use assets. The pack's animation only moves and
  // tints the battlers (no sheet); the arena adds its fallback flash.
  93: { usePackAnimation: true },
  // Psychic — review: use assets (battler-only animation, like Confusion).
  94: { usePackAnimation: true },
  // Barrier — review: "Pokemon body is still not centered in barrier
  // sprite. Pokemon seems to be top left". The panel is authored 14px right
  // of the user spot, and the body's center sits above it.
  112: { offset: { x: -14, y: -12 } },
  // Glare — review: "The glare assets should be facing the user. The
  // orientation should not change". The eyes are face art, drawn to be
  // looked at; the arena's direction rotation was turning them.
  137: { upright: true },
  // Lovely Kiss — review: "The attack sprite orientation is rotating. it
  // shuold not rotate". The figures either side of the target and the
  // heart on it are face art too.
  142: { upright: true },
  // Explosion — review: "Cycle through more of the attack animation. it
  // stops at smoke". The pack's Explosion draws only its sheet's smoke cell
  // (three puffs drifting around the user); the blast itself is a
  // full-screen white flash and a fire backdrop the conversion doesn't
  // ship. The puffs now step through the sheet's burst cells (0-3) before
  // its smoke (5-7), each puff a step behind the last, at the pack's own
  // pace so the sequence reads — the 50 idle frames the pack tacks on no
  // longer compress the 15 real ones into the attack window.
  153: { patternCycle: { patterns: [0, 1, 2, 3, 5, 6, 7], holdFrames: 2 }, playbackSpeed: 1 },
  // Flash — review: use assets (battler-only animation, like Confusion).
  148: { usePackAnimation: true },
  // Scary Face — review: "Scary face orientation should be fixed, facing
  // the user. It should not be rotating or upside down". The eyes and
  // mouth around the target are face art the direction rotation was turning.
  184: { upright: true },
  // Steel Wing — review: "Use assets". The slash is authored at the target spot.
  211: { usePackAnimation: true },
  // Sweet Scent — review: use assets.
  230: { usePackAnimation: true },
  // Future Sight — review: use assets (battler-only animation).
  248: { usePackAnimation: true },
  // Heat Wave stays on the arena's flame jet: the pack's animation is only
  // an overlay the conversion doesn't ship, and the review tried it and
  // sent it back ("Use arena effect").
  // Luster Purge — review: use assets, then "Remove the kanji characters
  // that show at the end". The ending is two dark ink-burst cells drawn
  // with the pack's subtractive blend (the glyph look) and the pack's
  // full-screen white flash, six tiles the arena can only show as rotated
  // white boards — all dropped; the orbs remain.
  295: { usePackAnimation: true, dropPatterns: [0, 1, 5] },
  // Dragon Dance — review: "Sprite seems too low". The swirls are drawn 22px
  // under the user spot and 8px left of it.
  349: { offset: { x: 8, y: -22 } },
  // Shock Wave — review: use assets.
  351: { usePackAnimation: true },
  // Draco Meteor — review: "Target sprite needs to be centered with attack
  // animation". The meteors' impact cells land 24px left and 12px below
  // the target spot.
  434: { offset: { x: 24, y: -12 } },
  // Leaf Storm — review: "Attack sprite doesnt seem centered for both
  // attacker and target". The leaf spirals circle 20px under the user spot
  // and 38px under the target spot.
  437: { offset: { y: -28 } },
  // Fire Pledge — review: "Use assets and center the target pokemon". The
  // pillar of fire is a screen-wide cell whose art centers at (377,148),
  // 52px under the target spot; pinned so that point sits on the target.
  519: { usePackAnimation: true, screenAnchor: { on: 'target', center: { x: 377, y: 148 } } },
  // Sludge Wave stays on the arena's poison effect: the pack's animation (its
  // Surf wave, recolored) was tried and the review picked "Keep the arena
  // effect". A `usePackAnimation: true` entry brings the wave back.
  // Leaf Tornado — review: "attack sprite on the target is a little low".
  // The tornado's art centers 16px below the target spot.
  536: { offset: { y: -16 } },
  // Origin Pulse — review: "Use assets, remove the kanji characters at the
  // end of the animation". The ending is four splash cells that read as
  // brush-stroke glyphs plus a full-screen white flash tile — dropped; the
  // beam of orbs remains.
  618: { usePackAnimation: true, dropPatterns: [5, 6, 7, 8, 9] },
  // Relic Song — review: use assets.
  547: { usePackAnimation: true },
  // Petal Blizzard — review: "Need to use better VFX": the pack's own petal
  // storm instead of the arena's generic rock burst.
  572: { usePackAnimation: true },
  // Brutal Swing — review: "Use the given assets. Target pokemon isn't
  // centered with attack asset". The swing's arc is a screen-wide cell
  // centered at (260,141) mid-screen; pinned so that point sits on the target.
  693: { usePackAnimation: true, screenAnchor: { on: 'target', center: { x: 260, y: 141 } } },
  // Shell Trap — review: use assets (the trap is authored at the target spot).
  704: { usePackAnimation: true },
  // Sunsteel Strike — review: "Attack sprite seems uncentered". The burst
  // lands 20px right of and 22px below the target spot (the charge sits
  // 13px under the user spot).
  713: { offset: { x: -18, y: -20 } },
  // Mind Blown — review: use assets.
  720: { usePackAnimation: true },
  // Springtide Storm — review: use assets (authored at the target spot).
  831: { usePackAnimation: true },
  // Bleakwind Storm — review: "Use assets" (authored at the target spot).
  846: { usePackAnimation: true },
  // Wildbolt Storm — review: use assets (authored at the target spot).
  847: { usePackAnimation: true },
  // Sandsear Storm — review: use assets (authored at the target spot).
  848: { usePackAnimation: true },
  // Mortal Spin — review: "Attacker sprite should be positioned a little
  // higher". The tornadoes circle 40px below the user spot.
  866: { offset: { y: -32 } },
  // Matcha Gotcha — review: use assets.
  902: { usePackAnimation: true },
  // Electro Shot — review: "Attack sprite looks uncentered from attacker".
  // The charge is authored 103px in front of the user (a side-view beam
  // that leaves the screen and re-enters at the target's height), which
  // the arena's diagonal mapping turns into "below and ahead"; this puts
  // the charge on the attacker.
  905: { offset: { x: -103 } },
  // Malignant Chain — review: "Move chain sprite up by a few pixels.
  // Centered positioning is correct", then "Lift it up a few more pixels".
  // The chain art sits 12px low in its cell.
  919: { offset: { y: -18 } },
};

export function getMoveVfxAdjustment(moveId: number): MoveVfxAdjustment | undefined {
  return MOVE_VFX_ADJUSTMENTS[moveId];
}
