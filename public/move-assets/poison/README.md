# Poison globule

`globule.png` is one frame cropped from the Gunk Shot charge-up animation in
a ripped *Pokémon Mystery Dungeon: Explorers of Time/Darkness* attack-effects
sheet ("Ripped by redblueyellow. No credit needed."), with its solid teal
background chroma-keyed to transparent. See
`src/render/vfx/moves/poisonAttack.ts` for how it's loaded and used — it's
the first real hand-drawn asset in this directory (see the parent
`README.md`'s "Current status" note); every other move-animation family
still draws its particles procedurally at runtime.
