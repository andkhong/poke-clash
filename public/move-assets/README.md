# Move VFX assets

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

v1 has **no files here yet** — the beam and lunge families currently draw their
particles procedurally at runtime (`src/render/vfx/moves/pixelTextures.ts`), the same
technique already used for the Pokémon reveal sparkle (`src/render/vfx/sparkle.ts`): a
small hand-authored pixel grid rendered once via Phaser `Graphics.generateTexture` with
nearest-neighbor filtering. This directory exists so real hand-drawn replacements have
an obvious home later, without needing any change to the *convention* below.

## Layout

```
move-assets/
  beam/    # projectile/particle art for beam-family moves (Ice Beam, Hydro Pump, Thunderbolt, Flamethrower, ...)
  lunge/   # impact/contact-flash art for lunge-family moves (Fire Punch, Mach Punch, Close Combat, Tackle, ...)
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
