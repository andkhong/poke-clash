# Brag Plan: Pokémon Brawl

## What is this app?
A free browser game where up to eight Pokémon auto-battle in free-for-all arenas around the clock, while spectators watch live, chat, and bet play money on who is left standing.

## The angle
**It is already happening.** Most launch videos say "introducing." This one says *right now*. The Featured Showcase room never stops — there is a real battle running while you read this, with a betting pool open on it. The video is shot like a **24/7 arcade broadcast bumper**: we cut into a match already in progress, place a bet, watch it pay out, and cut to the channel card. The specificity comes from using the project's own art (the real arena map, the real PMD sprites) and the project's own on-screen copy (`PLACE YOUR BETS!`, `🔮 PREDICTIONS`, `YOUR BALANCE`, `🔒 Closes in`, `CHARIZARD WINS!`).

## Hook (first 2-3 seconds)
The real arena, dark and pushed in, with the live pill already reading `● LIVE`. Two lines slam in:
**"RIGHT NOW,"** → **"8 POKÉMON ARE FIGHTING."**
Not a promise, a status report. The hook word is *RIGHT NOW*.

## Key moments (the middle)
- Eight **real PMD sprites** drop onto the **real arena map** around the Pokéball centre circle, two per beat, each with a squash-and-dust landing — then the game's actual `PLACE YOUR BETS!` banner slams across.
- The **predictions panel**, recreated from `src/ui/predictions/PredictionsPanel.tsx`: `YOUR BALANCE $100`, four fighter rows each reading `$300 · 8 bets · 2.1×`, and a countdown `🔒 Closes in 0:12`. A cursor clicks Charizard — the row lights magenta, the balance ticks $100 → $60, the pot bumps and the multiplier reticks — then the header flips to `🔒 CLOSED`.
- The brawl: Charizard's real Attack frame swings, a hit flash, an HP bar drains to zero, Gengar topples out of frame, and a `FIGHTERS LEFT` counter falls 08 → 01.
- The payout: `CHARIZARD WINS!` over the arena, `+$166` counting up into `YOUR BALANCE $226`, and the quiet true line `+$10 for watching`.

## Outro / punchline
The channel card: Pokéball mark, **POKÉMON BRAWL** in Press Start 2P, the real tagline "Watch Pokémon brawl. Bet on the winner.", and the three real chips `● LIVE 24/7` · `PLAY MONEY ONLY` · `NO SIGN-UP`. The joke lands on its own: we just watched someone win $166 and the card says *play money only*.

## User flow worth showing
Yes — this is the centrepiece, and scenes 2-5 are the flow end to end:
1. **Entry** — open the site, a free-for-all is already running in the Featured Showcase.
2. **Key action** — $100 play-money wallet, back a fighter before the bet window locks 45 seconds in.
3. **Result** — last one standing, backers split the pot parimutuel, +$10 for watching the match out.

## Tone
- Preset: `default`
- Creative direction: 24/7 arcade broadcast bumper — a channel ident for a live pixel-battle stream
- Interpretation: playful and confident, not shouty. Motion is snappy (0.3-0.5s entrances) with real holds after; type is blocky Press Start 2P for slams and Space Mono for product chrome. The energy comes from cuts landing on the beat and from pixel sprites physically hitting the ground — never from yanking text away before it can be read.

## Format: landscape — 1920x1080 @ 30fps
## Duration: 22.5s (3.0 + 4.0 + 5.0 + 3.5 + 4.3 + 3.0, with scenes 5 and 6 overlapping 0.3s)

## Visual identity (from the project)
- Background: `#fdf6e3` (theme.ts `BG`) — cream, used for the final card
- Stage: `#101216` (theme.ts `STAGE_BG`) — dark arena letterbox
- Panel: `#eee8d5` (theme.ts `BG_ALT`)
- Text: `#073642` (theme.ts `TEXT`), muted `#586e75` (`TEXT_MUTED`)
- Accent / primary: `#d33682` magenta (theme.ts `PRIMARY`), deep `#b02f6d` (`PRIMARY_DEEP`)
- Support: `#2aa198` teal (`SECONDARY`), `#cb4b16` orange (`ACCENT`), `#dc322f` red (`DESTRUCTIVE`), `#859900` green (`SUCCESS`)
- Display font: Press Start 2P (`FONT_DISPLAY`) — hook lines, wordmark and counters only, per theme.ts's own "display only" rule
- Match banners use Space Mono Bold, because that is what the real `BannerOverlay.tsx` renders
- Body font: Space Mono 400/700 (`FONT_MONO`)
- Retro treatment: hard offset shadows with no blur (`SHADOW_HARD` = `4px 4px 0 rgba(7,54,66,.12)`), 3D key edges under primary buttons (`0 4px 0 #b02f6d`), `image-rendering: pixelated` on every sprite
- Strongest visual element: the real wide arena map (`assets/img/arena.jpg`) with real PMD sprites standing on it

## Source assets already extracted
- `assets/img/arena.jpg` — the game's real wide arena (`map-assets/wide-background.jpg`), the fence line being the sim's actual playable border
- `assets/sprites/*.png` — real PMDCollab frames pulled from `pmd-sprite-mirror/`, row 0 (South / facing viewer) of each `Idle-Anim.png`, trimmed and upscaled 4× nearest-neighbour: charizard, pikachu, gengar, lucario, blastoise, venusaur, snorlax, dragonite, plus `charizard-attack.png` (mid-swing Attack frame)
- `assets/img/pokeball.png` — the in-battle Pokéball sprite, the project's brand mark

## Share copy (draft)
I built a site where Pokémon auto-battle 24/7 and you bet play money on who's left standing. No sign-up, nothing to buy — pokemonbrawl.com

## Audio direction
- Role: warm upbeat bed with sparse, motion-matched accents
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM, beat ≈ 0.5225s)
- Music treatment: start at 0, quick fade-in over the first 0.4s, sit under the visuals, duck slightly under the `CHARIZARD WINS!` payoff hit so the announcement rings, fade out across the final 1.2s of the channel card
- Music cue guidance: bundled preset read from `assets/music/…music-cues.json`. **Three primary strong-cue locks** — 5.28s (`PLACE YOUR BETS!` banner), 16.86s (`CHARIZARD WINS!` banner), 19.49s (channel card lands). Secondary optional cues if they help: 1.60s (hook line 2), 8.44s (the bet click), 14.22s (the big hit). Beat-grid windows: the eight sprite landings at 3.18 / 3.70 / 4.23 / 4.75 (two per beat), and the four prediction rows at 7.38 / 7.65 / 7.91 / 8.18 (one per half-beat).
- Audio-reactive treatment: subtle — drive the arena's vignette warmth and the magenta glow on the live pill / winner banner from music RMS. No waveform bars, no equalizers, no particle systems.
- SFX posture: moderate but restrained. Motion-matched only.
- Audio-coupled moments: sprite landings (soft impact per pair), prediction rows arriving (card-slide each), the cursor press on Charizard (single click), the bet window locking (switch/latch), the Attack swing and KOs (impact), the winner banner (one announcement hit allowed to ring over the ducked music), the payout counter (light chip/coin ticks)
- Restraint rule: no sound on pure text fades, nothing on the final URL, and never more than one accent per beat — if a beat already carries music emphasis, let it carry it alone.

## Storyboard

### Scene 1 — Cold open: "RIGHT NOW" — 3.0s (0.0 → 3.0)
Real arena image, darkened to ~32% over `#101216`, slowly pushing in (Ken Burns, 1.16 → 1.10). Top-left: the project's real live pill — magenta `● LIVE` badge plus `3 live battles · 12 rooms open` in Space Mono. Centre: **"RIGHT NOW,"** slams in at 0.30s, **"8 POKÉMON ARE FIGHTING."** slams in at 1.60s (beat-locked to a strong cue), both Press Start 2P, cream on dark with a hard offset shadow. Both hold to 3.0s (line 1 gets 2.70s, line 2 gets 1.40s against a 1.2s floor).
Sequential/interaction: yes — two-line sequential slam, 1.3s apart, each holding well past the reading floor.
Audio intent: music enters immediately, already mid-groove, like tuning into a channel that was already on.
Audio-coupled idea: a low impact under each line slam.
Music: upbeat, warm.
Transition mood: hard cut → Scene 2

### Scene 2 — The arena fills — 4.0s (3.0 → 7.0)
Cut to the arena at full brightness, framed wide on the whole field. The eight real PMD sprites drop in around the Pokéball centre circle — two per beat across 3.18-4.75s — each landing with a squash and a small dust puff and an elliptical ground shadow. A small Space Mono name chip fades in under each sprite and the whole set holds. At 5.28s the game's real **`PLACE YOUR BETS!`** banner slams across centre and holds to 7.0s.
Sequential/interaction: yes — 8 sprites arriving two at a time on consecutive beats; name chips are text but tiny, and the full set holds 1.8s+ after the last arrival.
Audio intent: builds — each pair of landings adds weight until the banner caps it.
Audio-coupled idea: soft impact per landing pair; one short announcement cue on the banner.
Music: driving.
Transition mood: clean wipe → Scene 3

### Scene 3 — The bet — 5.0s (7.0 → 12.0)
Cut to the predictions panel on the dark stage, recreated from the real component: header `🔮 PREDICTIONS` with status `🔒 Closes in 0:12` in magenta, wallet row `YOUR BALANCE` / `$100`. Four fighter rows arrive one per half-beat across 7.38-8.18s, each a sprite thumb plus name plus `$300 · 8 bets · 2.1×`. A cursor slides to the CHARIZARD row and presses at 8.44s: the row takes the real magenta selection ring (`0 0 0 1px #d33682`), `YOUR BALANCE` ticks $100 → $60, Charizard's pot bumps $120 → $160 and its multiplier shortens 5.2× → 4.2×. At 11.06s the header flips to `🔒 CLOSED` in muted grey and the rows dim.
Sequential/interaction: yes — four rows on the beat grid, then a simulated cursor click on Charizard, then a lock state change.
Audio intent: precise and tactile — this is the moment the viewer understands the product.
Audio-coupled idea: card-slide per row arrival; one click on the cursor press; a latch/switch on `🔒 CLOSED`.
Music: steady under, no swell — let the SFX carry.
Transition mood: hard cut → Scene 4

### Scene 4 — The brawl — 3.5s (12.0 → 15.5)
Back to the arena, punched in tighter and shaking slightly. Charizard's real Attack frame swings at 14.22s with a white hit flash; a fighter's HP bar drains red and it greys out and topples. A `KO` chip flicks off as it goes. Top-left, a `FIGHTERS LEFT` counter ticks 08 → 05 → 03 → 02 → 01, flashing red on each drop — one readable signal instead of a roster column nobody has time to read. Fastest cutting in the video, minimal text.
Sequential/interaction: yes — sequential KOs driving a single counter.
Audio intent: impact and consequence — the stakes just set in scene 3 being spent.
Audio-coupled idea: impact hits on the swing and each KO.
Music: pushing.
Transition mood: flash → Scene 5

### Scene 5 — The payoff — 4.3s (15.5 → 19.8, the last 0.3s crossfading under the card)
The arena settles, Charizard alone in frame. At 16.86s the game's real **`CHARIZARD WINS!`** banner slams across and holds. Beneath it the wallet settles: `+$168` counts up in green `#859900`, resolving into `YOUR BALANCE  $228`, with the small true line `+$10 for watching` in muted grey underneath. Everything holds to 19.5s, then fades under scene 6.
Sequential/interaction: yes — banner, then a counting payout, then the watched-match line.
Audio intent: release. The single biggest hit in the video.
Audio-coupled idea: one announcement hit rings over briefly ducked music; light chip ticks under the counting number.
Music: ducks ~0.5s for the hit, then returns.
Transition mood: soft crossfade → Scene 6

### Scene 6 — The channel card — 3.0s (19.5 → 22.5)
Cream `#fdf6e3` card with a retro hard offset shadow lands at 19.49s. Pokéball mark above **POKÉMON BRAWL** in Press Start 2P. Under it, verbatim: "Watch Pokémon brawl. Bet on the winner." in Space Mono, in at 20.0s, holding 2.5s against a 1.8s floor. Three real chips at 20.54s: `● LIVE 24/7` (magenta), `PLAY MONEY ONLY`, `NO SIGN-UP`. `pokemonbrawl.com` at 21.06s. A strip of all eight real sprites lines the bottom of the card from 20.72s — the cast, and the reason the final frame is postable on its own. All hold to the end while the music fades.
Sequential/interaction: yes — wordmark, tagline, chip row, URL, each holding past its floor.
Audio intent: settle and close.
Audio-coupled idea: nothing on the URL — let the music fade carry the ending.
Music: fades out across the final 1.2s.

**Music mood for this video:** upbeat
**Audio summary:** A warm 114 BPM bed runs unbroken from a cold open, gathering weight through eight sprite landings and a tactile bet sequence, spiking on one ducked announcement hit at the win, then fading out under the channel card.
