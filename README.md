# PokéBets Arena

Pokémon auto-battle in free-for-all arenas around the clock. Spectators watch live, chat, and bet play money on the winner.

**Live:** https://pokebets.fly.dev

## Features

- **Live auto-battles.** Up to eight Pokémon fight on their own. A server-authoritative simulation handles damage, type matchups, status effects, movement and AI.
- **Multiplayer rooms.** Free-for-all, boss and team rooms stream to every viewer over Server-Sent Events. An always-on Featured Showcase room means there is always a match to watch.
- **Betting with play money.** Each browser tab starts with $100 and earns $10 for every match it watches.
  - Bets close 45 seconds into a match.
  - Payouts are parimutuel, and win odds are computed on the server.
- **Shop.** Viewers spend winnings on Potions, Super Potions and Revives to help a fighter mid-match.
- **Chat.** Every viewer gets chat, with a generated spectator name, a language filter and rate limits.
- **Solo play.** Quick matches, custom battles, boss mode and team mode run entirely in the browser.
- **Mobile support.** Phones get a portrait arena and touch-friendly chat, betting and shop panels.

## Tech stack

| Layer | Tools |
|---|---|
| Client | React 18, Phaser 3, TypeScript, Vite |
| Servers | Node.js 22 (game server and sprite server), bundled with esbuild |
| Testing | Vitest, ESLint, `tsc` |
| Hosting | Fly.io, Caddy |

## Getting started

### Prerequisites

- Node.js 22
- `ffmpeg` on your `PATH`, only if you run the audio pipeline scripts

### Install and run

```sh
npm install
npm run data:fetch-pmd-sprites   # download battle sprites into pmd-sprite-mirror/
npm run dev:all                  # Vite, sprite server and game server together
```

Open http://localhost:5173.

- **Sprites:** the sprite mirror is not committed. By default the fetch script downloads a small set of test species; set `PMD_SPRITE_ALL=true` to fetch the full roster. You don't need to rebuild the Pokémon and move dataset, because the generated copy in `src/data/generated/` is committed.
- **Dev servers:** `npm run dev:all` runs three processes:

  | Process | Port | Purpose |
  |---|---|---|
  | Vite | 5173 | The app. Proxies `/api` to the game server, and `/pmd-sprites` and `/soundtracks` to the sprite server. |
  | Sprite server | 4310 | Serves the local sprite and soundtrack mirrors. |
  | Game server | 4311 | Multiplayer rooms, betting, wallets, shop and chat. |

The game server does not reload on file changes; restart it after editing anything in `game-server/`.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `GAME_SERVER_PORT` | `4311` | Game server port |
| `PMD_SPRITE_SERVER_PORT` | `4310` | Sprite server port |
| `GAME_SERVER_BOTS` | enabled | Set to `0` to turn off the Featured Showcase's bot spectators |
| `PMD_SPRITE_ALL` | unset | Set to `true` to fetch every species' sprites instead of the test set |

## Scripts

| Command | Description |
|---|---|
| `npm run dev:all` | Run the app with both servers |
| `npm run dev` | Run the Vite dev server only |
| `npm run build` | Type-check, build the client and precompress the output |
| `npm run build:servers` | Bundle the game and sprite servers |
| `npm test` | Run the test suite |
| `npm run lint` | Lint the project |

Scripts prefixed with `data:` rebuild the dataset, sprites, move animations and audio. [DEPLOY.md](DEPLOY.md) describes them.

## Project structure

```
src/
  sim/            Battle engine: damage, type chart, AI, movement, status effects, odds
  render/         Phaser scenes, sprites, move VFX and sound
  ui/             React screens, HUD, chat, betting, shop and landing page
  net/            Room protocol, SSE client, and chat and shop rules shared with the server
  data/           Generated Pokémon and move dataset, with loaders
  review/         Move VFX review tool (/review.html)
game-server/      Multiplayer rooms, predictions, wallets, shop and bot spectators
sprite-server/    Serves the local sprite and soundtrack mirrors
data-pipeline/    Dataset, sprite, animation and audio build scripts
scripts/          Build and deploy helpers
public/           Static assets shipped with the build
```

## Move VFX review

`/review.html` plays every move on a stage with two arena Pokémon. It uses the same animation, pose, timing, label and sound as a real match. Run `npm run dev:all` so the sprite server can serve the Pokémon art.

- **Marking moves.** Flag any move whose effect should change and leave a note. With the dev server running, marks are saved to `vfx-review/marks.json`, with a readable summary in `vfx-review/REVIEW.md`. On the deployed site marks stay in the browser; use **Download JSON** and **Import JSON** to move them to a local checkout.
- **Recording fixes.** Record each change in `vfx-review/changes.json`:
  ```json
  { "<move id>": { "summary": "…", "changedAt": "<ISO time>" } }
  ```
  The page then shows before and after playback, with **Approve** and **Request changes**. A change made after a verdict puts the move back under review.
- **Unused assets mode.** Lists moves where the arena draws its own effect even though the animation pack ships one. For each move, choose whether to use the pack's animation or keep the arena effect.
- **Tuning.** Per-move tuning lives in `src/render/vfx/moveVfxAdjustments.ts`.

## Deployment

Production runs on a single Fly.io machine:
- Caddy serves the static build and reverse-proxies to the game and sprite servers.
- The large sprite and music mirrors live on a Fly volume.

```sh
fly deploy
```

[DEPLOY.md](DEPLOY.md) covers preparing and uploading the volume, keeping sprites in sync with upstream, and caching.

## Disclaimer

PokéBets Arena is a free, non-commercial fan project. All betting uses play money, which has no cash value and cannot be bought, sold or withdrawn.

This project is not affiliated with, endorsed by or sponsored by Nintendo, The Pokémon Company or Game Freak. Pokémon and all related names are trademarks of their respective owners.
