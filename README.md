# poke-clash

## Reviewing move VFX

`/review.html` (`npm run dev`, then <http://localhost:5173/review.html>; also
shipped with the production build) lists every move and plays it on a stage
with two real arena Pokémon, using the exact animation, pose, timing, label
and sound a match shows. Mark any move whose effect should change and leave
a note. Run `npm run dev:all` so the sprite server can serve the Pokémon
art. Source: `src/review/`.

With the dev server running, every change is written into the repo:
`vfx-review/marks.json` is what the page reloads next time, and
`vfx-review/REVIEW.md` is the readable version to hand to a coding agent
("act on vfx-review/REVIEW.md"). On the deployed site there is no server
behind the page, so marks stay in that browser; use Download JSON there and
Import JSON locally to bring them across.

Whoever acts on a mark records what they did in `vfx-review/changes.json`
(`{ "<move id>": { "summary": "…", "changedAt": "<ISO time>" } }`). The page
then shows the summary next to the move with **Before** / **After** playback
(before = anchors at the feet and no per-move tuning, i.e. the arena as it
was before the review; after = today's code) and **Approve** / **Request
changes** with a feedback box. Verdicts land back in `marks.json` and the
Status column of `REVIEW.md`; a change made after a verdict puts the move
back under review. Per-move tuning lives in
`src/render/vfx/moveVfxAdjustments.ts`.

The **Unused assets** list mode narrows the list to moves the arena draws
with its own effect although the pack ships an animation for them (its
animation is screen-wide, or the review set it aside). Each shows
**With assets** / **Arena effect** playback and a pick — **Use the assets**
or **Keep the arena effect** — recorded in the Assets column of
`REVIEW.md`; "use the assets" is applied with `usePackAnimation` in the
tuning table, after which the move plays the pack animation and the same
pick can send it back.
