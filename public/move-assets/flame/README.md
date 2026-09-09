# Flame burst

`burst.png` is a single flame-burst frame cropped from a ripped *Pokémon
FireRed/LeafGreen* battle-effects sheet ("Pokémon attack sprites ripped by
wormintheworks. Made By Nintendo... Please give credit for this if used in
anything" — www.gmhandbk.webs.com), with its solid green background
chroma-keyed to transparent. See `src/render/vfx/moves/flameAttack.ts` for
how it's loaded and used — replaces the procedural flame-lick particle. Used
as-is (no runtime tint, unlike the procedural texture it replaces) — fire's
own orange/red already reads correctly for its one other user (dragon, via
the same jet), same "pre-colored, used as-is" convention as `poison`/`water`.
