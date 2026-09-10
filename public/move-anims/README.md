# Move animations

Every attack, status move, and status condition the arena shows is played
from this directory. Nothing here is hand-authored: it is the output of
`npm run data:build-move-animations` (`data-pipeline/build-move-animations.ts`)
over the **Gen 9 Move Animation Project**, a Pokémon Essentials animation
pack, converted into a compact JSON format the arena's own player understands
(`src/render/vfx/anim/`, format in `src/data/moveAnimationFormat.ts`).

## Screen-wide effects are the exception

The pack was drawn for a side-view battle screen. An animation that anchors
most of its cells to that whole screen (Surf's waves, Earthquake's shaking
ground, Growl's sound rings) or that draws nothing but a full-screen
background/foreground overlay (Heat Wave, Psychic) doesn't translate to a
free-roaming top-down arena, so the converter flags those moves (`screen: true`
in the index — 27 moves at the time of writing) and the arena plays its own
family VFX for them instead, from `public/move-assets/` and
`src/render/vfx/moves/`. The flag is derived, not hand-picked: at least half the
cells anchored to the screen, or no cells plus an overlay (self-targeting moves
excepted, since the family VFX draw nothing for those).

## Layout

```
move-anims/
  moves/<moveId>.json   # one animation per move in src/data/generated/moves.json, plus -1 (Struggle)
  common/<name>.json    # the pack's status-condition/stat animations (Poison, Burn, Paralysis, Frozen, ...)
  sheets/<slug>.png     # only the 192x192-cell sprite sheets those animations reference;
                        # <slug>--hue<deg>.png is the same sheet with its colors hue-rotated,
                        # for the animations the pack plays with a hue shift
```

Served as static files (Vite's `public/`, Caddy's `/move-anims/*` rule) and
fetched on demand: `src/data/generated/moveAnimations.json` is the small index
the app bundles, and the arena queues every move its roster can use during
`ArenaScene.preload()`. URLs carry `?v=<MOVE_ANIM_ASSET_VERSION>`
(`src/render/vfx/anim/moveAnimLoader.ts`) — bump that whenever the converter's
output changes.

## Regenerating

1. Unzip the pack to `Gen 9 Move Animation Project/` in the repo root
   (gitignored — it is ~80 MB, most of it sound effects the game doesn't use),
   or point `MOVE_ANIM_PACK_DIR` at it.
2. `npm run data:build-move-animations` (`--force` to re-encode every sheet).
   It refuses to finish if any move reachable in play has no animation.
3. `npm test` — `src/render/vfx/anim/moveAnimations.test.ts` checks the
   index against the move dataset and the files on disk.

## Source and credits

The pack bundles the **Pokémon Reborn** battle animation sheets (`PRAS-` prefix)
and sound effects (`PRSFX-`), plus community additions for generation 8 and 9
moves, assembled for Pokémon Essentials as the Gen 8 / Gen 9 Move Animation
Project. The copy this was built from shipped without a readme or credits file.
Before publishing a build that includes these, add the authors' credit list
from the project's download page here and to wherever the app credits its other
art (the Pokémon Reborn team for the base sheets and effects; the Move Animation
Project contributors for the assembly and the newer moves). All Pokémon art is
© Nintendo / Game Freak / Creatures Inc.
