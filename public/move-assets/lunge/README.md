# Lunge punch impact

`punch1.png`/`punch2.png`/`punch3.png` are a 3-frame gloved-fist punch
sequence cropped from a ripped *Pokémon FireRed/LeafGreen* battle-effects
sheet ("Pokémon attack sprites ripped by wormintheworks. Made By Nintendo...
Please give credit for this if used in anything" — www.gmhandbk.webs.com),
each with its solid green background chroma-keyed to transparent. See
`src/render/vfx/moves/impactBurst.ts`/`PokemonSprite.ts`'s `playLungeAttack`
for how they're loaded and used — a quick contact-flash flip-book played at
the moment of impact, on top of the existing sparkle burst. Used as-is
(no runtime tint), same reasoning as `poison`/`water`: a punch-impact flash
reads fine regardless of the attacking move's type.
