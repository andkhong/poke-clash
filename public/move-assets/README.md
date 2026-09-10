# Move VFX assets

> **Scope since the Gen 9 Move Animation Project migration:** most moves now
> play the converted pack animations in `public/move-anims/` (see its README).
> The family VFX here are used only for the moves the converter flags as
> screen-wide (`screen: true` in `src/data/generated/moveAnimations.json` —
> Surf, Earthquake, Growl, Heat Wave, Psychic, ...), whose side-view,
> whole-screen animations don't translate to the top-down arena. The status
> particles that used to borrow this art play the pack's own status animations
> instead. Everything below describes the family system itself and still holds
> for those moves.

Pixel art for move animations, organized by **animation family** (see
`src/render/vfx/moveAnimations.ts`) rather than by individual move — the whole point
is that many moves share the same handful of assets, re-tinted per move type, instead
of every move needing its own hand-drawn art.

This directory is served directly by Vite's static `public/` dir (same convention as
`public/cries/{pokedexId}.ogg`), so files here are referenced by root-relative URL
strings (e.g. `/move-assets/beam/particle.png`) — no import, no build step, no separate
dev server (unlike `pmd-sprite-mirror/`, which is gitignored and served by
`sprite-server/` purely because of its size; this directory is small/curated and meant
to be committed straight to git).

## Current status

Only `impact` (the original generic fallback, `moveEffects.ts`) and `wave`
(Surf's curling water crest, `waveAttack.ts`) still draw everything
procedurally at runtime (`src/render/vfx/moves/pixelTextures.ts`), the same
technique already used for the Pokémon reveal sparkle
(`src/render/vfx/sparkle.ts`): a small hand-authored pixel grid rendered once
via Phaser `Graphics.generateTexture` with nearest-neighbor filtering. Every
other family now has at least one real cropped-art asset (see each
directory's own README for its specific source/credit note), loaded via an
explicit preload rather than the lazy-generate-on-first-use pattern the
procedural textures use.

Most of these are drawn as-is, with no runtime tint — their source art is
already the right color and only ever used on-type (poison-purple for
poison, water-blue for Hydro Pump, fire-orange for flame, electric-yellow
for thunder, ice-blue for iceShard, grass-green for leaf, rock-brown for
rockBurst, grey for vortex, pink for the lunge punch flash). `beam` is the
one exception: its charge-column art is near-white/yellow specifically so it
still takes a runtime tint per move type, the same as the procedural texture
it replaces (see its own README).

## Layout

```
move-assets/
  beam/      # real hand-drawn charge-column art, tinted per move type — see its own README
  bubble/    # real hand-drawn art for Bubble/Bubble Beam — see its own README
  flame/     # real hand-drawn art for fire (+ dragon) special moves — see its own README
  iceShard/  # real hand-drawn art for Ice Shard/Icicle Spear + special ice movepool — see its own README
  leaf/      # real hand-drawn art for Razor Leaf — see its own README
  lunge/     # real hand-drawn punch-impact flip-book for lunge-family moves — see its own README
  poison/    # real hand-drawn art for the poison family (Sludge, Sludge Bomb, Gunk Shot, Acid, ...) — see its own README
  rockBurst/ # real hand-drawn art for ground spread moves + the physical-spread catch-all — see its own README
  vortex/    # real hand-drawn art for Hurricane — see its own README
  water/     # real hand-drawn art for Hydro Pump/Hydro Cannon specifically — see its own README
```

## Conventions for future files

- **One base asset per concept, not per move.** A single `beam/particle.png` (drawn in
  flat white/grey, no baked-in color) covers every beam move — at runtime it's tinted
  to the move's type color the same way shiny Pokémon sprites get a flat recolor tint
  (`SHINY_TINT_COLOR` in `PokemonSprite.ts`). Don't add a separate file per element/type
  unless a specific move's shape genuinely needs different art, not just a different
  color.
- **Small and chunky.** Match the PMD sprite mirror's pixel density, not smooth vector
  art — these read at a similar on-screen scale to the sparkle/impact particles already
  in the game (roughly 6-16px source art, nearest-neighbor scaled up).
- **PNG, transparent background.**
- Adding a real file here doesn't do anything by itself yet — a loader would need to be
  added to `src/render/vfx/moves/pixelTextures.ts` (or alongside it) to fetch and use it
  in place of the procedural texture. That's intentionally left for whenever real art
  actually lands.
