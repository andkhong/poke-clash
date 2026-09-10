// Per-move tuning of the arena's move VFX on top of what the pack ships —
// the outcome of reviews on /review.html (see vfx-review/). Anything not
// listed plays untouched. Each entry cites the review note it answers so a
// later reviewer can tell why it exists. The review page can play a move
// with these switched off to show the "before".

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
  /** Pins a screen-wide animation's screen-focused cells on one battler,
   * with the canonical point `center` landing on it — see geometry.ts's
   * ScreenAnchor. */
  screenAnchor?: ScreenAnchor;
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
  // Blizzard — review: "Sprite is a little wide. Shrink it by 10%".
  59: { scale: 0.9 },
  // Aurora Beam — review: "Beam could be bigger".
  62: { scale: 1.35 },
  // Thunderbolt — review: "Reuse the previous thunder VFX for this move":
  // the arena's jagged bolt (moves/thunderAttack.ts) over the pack's animation.
  85: { preferArenaVfx: true },
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
  // Barrier — review: "Pokemon body is still not centered in barrier
  // sprite. Pokemon seems to be top left". The panel is authored 14px right
  // of the user spot, and the body's center sits above it.
  112: { offset: { x: -14, y: -12 } },
  // Flash — review: use assets (battler-only animation, like Confusion).
  148: { usePackAnimation: true },
  // Steel Wing — review: "Use assets". The slash is authored at the target spot.
  211: { usePackAnimation: true },
  // Sweet Scent — review: use assets.
  230: { usePackAnimation: true },
  // Future Sight — review: use assets (battler-only animation).
  248: { usePackAnimation: true },
  // Heat Wave stays on the arena's flame jet: the pack's animation is only
  // an overlay the conversion doesn't ship, and the review tried it and
  // sent it back ("Use arena effect").
  // Luster Purge — review: use assets.
  295: { usePackAnimation: true },
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
  // Leaf Tornado — review: "attack sprite on the target is a little low".
  // The tornado's art centers 16px below the target spot.
  536: { offset: { y: -16 } },
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
