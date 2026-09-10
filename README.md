# poke-clash

## Reviewing move VFX

`/review.html` (`npm run dev`, then <http://localhost:5173/review.html>; also
shipped with the production build) lists every move and plays it on a stage
with two real arena Pokémon, using the exact animation, pose, timing, label
and sound a match shows. Mark any move whose effect should change and leave
a note; marks are kept in the browser and export as a Markdown table (to
paste into a conversation) or JSON (to re-import). Run `npm run dev:all` so
the sprite server can serve the Pokémon art. Source: `src/review/`.
