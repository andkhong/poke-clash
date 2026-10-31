# Hyperframes Composition Brief: Pokémon Brawl

## Objective
Create a short launch-style brag video for Pokémon Brawl — a free browser game where up to eight Pokémon auto-battle in free-for-all arenas 24/7 while spectators watch live, chat, and bet play money on the winner.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 22.5 seconds

## Source Material
- Project root: `/Users/an/Desktop/poke-clash`
- Primary files read: `index.html`, `README.md`, `src/ui/theme.ts`, `src/ui/landing/LandingHero.tsx`, `src/ui/landing/HowItWorks.tsx`, `src/ui/landing/landingCss.ts`, `src/ui/predictions/PredictionsPanel.tsx`, `src/ui/hud/BannerOverlay.tsx`, `docs/launch-copy.md`
- Product name: **Pokémon Brawl** (live at pokemonbrawl.com)
- Tagline / strongest claim: "Watch Pokémon brawl. Bet on the winner."
- Key UI moments to recreate:
  1. The **real arena** (`assets/img/arena.jpg`) with **real PMD sprites** standing on it — this is the game's actual rendered world, not a mockup.
  2. The **predictions panel** from `src/ui/predictions/PredictionsPanel.tsx` — header, wallet row, fighter rows with pot/bets/multiplier, countdown status.
  3. The **banner overlay** from `src/ui/hud/BannerOverlay.tsx` — `PLACE YOUR BETS!` and `CHARIZARD WINS!`.
- Copy that must appear verbatim (all of it is real on-screen product copy):
  - `● LIVE` and `3 live battles · 12 rooms open` (the landing hero's live pill)
  - `PLACE YOUR BETS!`
  - `🔮 PREDICTIONS`
  - `🔒 Closes in 0:12` and `🔒 CLOSED`
  - `YOUR BALANCE`
  - `CHARIZARD WINS!`
  - `Watch Pokémon brawl. Bet on the winner.`
  - `● LIVE 24/7`, `PLAY MONEY ONLY`, `NO SIGN-UP`
  - `pokemonbrawl.com`

## Creative Direction
- Tone preset: `default`
- Creative direction: 24/7 arcade broadcast bumper — a channel ident for a live pixel-battle stream
- Interpretation: playful and confident, not shouty. Snappy 0.3-0.5s entrances followed by real holds. Blocky Press Start 2P for slams, Space Mono for product chrome. Energy comes from cuts landing on the beat and pixel sprites physically hitting the ground — never from pulling text off before it can be read.
- Angle: **It is already happening.** Most launch videos say "introducing." This one says *right now*. The Featured Showcase room never stops — there is a real battle running with a real betting pool open on it as you watch. So the video cuts into a match already in progress, places a bet, watches it pay out, and cuts to the channel card.
- Hook: the real arena, dark and pushing in, live pill already reading `● LIVE`, then two slams — **"RIGHT NOW,"** → **"8 POKÉMON ARE FIGHTING."**
- Outro / punchline: the channel card. We just watched someone win $168 and the chip row says `PLAY MONEY ONLY`. The joke lands without a line of setup.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign — the project already has a complete, opinionated design system; use it
  - Any implication that real money is involved

## Visual Identity
All values are from `src/ui/theme.ts`, the project's single source of truth.
- Background (final card): `#fdf6e3` (`BG`)
- Stage (arena letterbox): `#101216` (`STAGE_BG`)
- Panel: `#eee8d5` (`BG_ALT`)
- Text: `#073642` (`TEXT`); muted `#586e75` (`TEXT_MUTED`); border `#839496` (`BORDER`)
- Accent / primary: `#d33682` magenta (`PRIMARY`); deep `#b02f6d` (`PRIMARY_DEEP`); on-primary text `#ffffff`
- Support: `#2aa198` teal (`SECONDARY`), `#cb4b16` orange (`ACCENT`), `#dc322f` red (`DESTRUCTIVE`), `#859900` green (`SUCCESS`)
- Display font: **Press Start 2P** (wordmark, section titles, banner slams — crisp at multiples of 8px, use 16/24/48)
- Body font: **Space Mono** 400/700 (all product chrome)
- Retro treatment carried from the app: hard offset shadows with no blur (`4px 4px 0 rgba(7,54,66,.12)`, large `6px 6px 0 rgba(7,54,66,.14)`), 3D key edge under primary buttons (`0 4px 0 #b02f6d`), pill radius 999, card radius 14, `letter-spacing:.08em` on button/chip labels
- **`image-rendering: pixelated` on every sprite and on the arena image** — this is pixel art and must never be smoothed
- Visual references from the project: the wide arena map with its fence as the playable border; the Pokéball centre circle; the magenta live pill; the predictions panel's row layout

## Local assets (already extracted and staged)
- `assets/img/arena.jpg` — 1920x1080, the game's real wide arena from `map-assets/wide-background.jpg`
- `assets/img/pokeball.png` — 256x256, the in-battle Pokéball sprite, used as the brand mark
- `assets/sprites/{charizard,pikachu,gengar,lucario,blastoise,venusaur,snorlax,dragonite}.png` — real PMDCollab frames from the project's own `pmd-sprite-mirror/`, row 0 (South / facing the viewer) of each `Idle-Anim.png`, alpha-trimmed and upscaled 4× nearest-neighbour
- `assets/sprites/charizard-attack.png` — mid-swing frame from Charizard's real `Attack-Anim.png`
- `assets/sprites/manifest.json` — exact pixel dimensions for every sprite above
- `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` plus its `…music-cues.json` preset

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. **Cold open: "RIGHT NOW"** — 3.0s (0.0→3.0) — darkened arena pushing in, live pill, two-line slam: "RIGHT NOW," / "8 POKÉMON ARE FIGHTING."
2. **The arena fills** — 4.0s (3.0→7.0) — 8 real sprites drop in two per beat with squash + dust + ground shadow, name chips, then `PLACE YOUR BETS!` slams at 5.28s
3. **The bet** — 5.0s (7.0→12.0) — predictions panel; 4 rows on the beat grid; cursor clicks Charizard at 8.44s (row rings magenta, balance $100→$60, pot $240→$280); header flips to `🔒 CLOSED`
4. **The brawl** — 3.5s (12.0→15.5) — Charizard's Attack frame swings at 14.22s, hit flash, HP drains, two KOs, roster rows strike through
5. **The payoff** — 4.0s (15.5→19.5) — `CHARIZARD WINS!` at 16.86s, `+$168` counts up into `YOUR BALANCE $228`, `+$10 for watching`
6. **The channel card** — 3.0s (19.5→22.5) — Pokéball + POKÉMON BRAWL wordmark at 19.49s, real tagline, three chips, `pokemonbrawl.com`

## Audio
- Audio role: warm upbeat bed with sparse, motion-matched accents
- Audio arc: music enters already mid-groove (cold open), gathers weight through the eight sprite landings, goes tactile and precise under the bet sequence, pushes through the brawl, spikes on one ducked announcement hit at the win, then fades out under the channel card
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` — 114.84 BPM, beat ≈ 0.5225s
- Music treatment: start at 0 with a 0.4s fade-in; sit under the visuals; duck ~0.5s under the `CHARIZARD WINS!` hit so the announcement rings; fade out across the final 1.2s
- Music cue guidance: bundled preset at `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json`. **Three primary strong-cue locks:** 5.28s (`PLACE YOUR BETS!`), 16.86s (`CHARIZARD WINS!`), 19.49s (channel card lands). Secondary optional: 1.60s (hook line 2), 8.44s (bet click), 14.22s (the big hit). **Beat-grid windows:** eight sprite landings across 3.4-5.2s (two per beat); four prediction rows across 7.4-9.5s (one per beat). Mark locks `// beat-locked: <t>s` and grids `// beat-grid: …`.
- Audio-reactive treatment: subtle — drive the arena vignette warmth and the magenta glow on the live pill / winner banner from music RMS. No waveform bars, no equalizers, no particle systems, no strobing.
- Audio-coupled moments:
  - Scene 1, each hook line slam — low impact
  - Scene 2, each sprite landing pair — soft impact
  - Scene 2, `PLACE YOUR BETS!` — short announcement cue
  - Scene 3, each prediction row arriving — card-slide
  - Scene 3, cursor press on Charizard — single click
  - Scene 3, `🔒 CLOSED` — latch / switch
  - Scene 4, Attack swing and each KO — impact
  - Scene 5, `CHARIZARD WINS!` — one announcement hit ringing over ducked music
  - Scene 5, `+$168` counting — light chip/coin ticks
  - Scene 6, URL — nothing; the music fade carries the ending
- SFX selection guidance: the bundled SFX library at `~/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/` has `casino/` (card-place, card-slide, chip sounds — a natural fit for a betting product), `impact/`, `interface/` and `ui/`. Match sound to motion, not to the beat for its own sake. Never more than one accent per beat; if a beat already carries music emphasis, let it carry it alone.
- SFX analysis guidance: `~/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/sfx-analysis.md` — prefer lower high-frequency-risk files for the repeated sprite landings and row arrivals.
- Exact SFX choice: Hyperframes should choose filenames, timestamps, density, and volume based on the implemented animation.
- Audio files: copy the chosen music and any selected SFX into `brag-output/composition/assets/` (music is already in place).

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show real UI, copy, and visual elements from the source project — the staged arena image, PMD sprites, and verbatim copy above are all genuine product material.
- Keep all text readable in the final render. Reading floors: short label ≈ 0.8s settled; full sentence ≈ 0.3s per word, minimum 1.2s. Every line in the storyboard already clears its floor — preserve that.
- Keep the video within 15-25 seconds (target 22.5s).
- Include the planned music/SFX layer.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints. Major reveals may move within ~0.15s of a strong cue; smaller entrances within ~0.10s of a beat. Ignore any cue that hurts readability or pacing.
- Use SFX to support motion and interaction, with restraint when the edit is already busy.
- Honour the planned music treatment (fade-in, duck under the win hit, fade-out).
- Use the Hyperframes audio-reactive workflow to extract audio data and wire at least one visual element to it, subtly. If extraction is unavailable, note it and skip — do not block the render.
- Use local assets only. No remote runtime or media dependencies. Fonts: Press Start 2P and Space Mono must be available to the renderer deterministically.
- Run `hyperframes check` before render — it is brag's single gate.
