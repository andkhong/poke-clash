# PokéBets Arena: launch copy

Draft. Lines marked [CONFIRM] are placeholders to check before posting; the domain is pending confirmation.

Framing rules for every post:
- Free.
- Non-commercial fan project.
- **Play money only**, with no cash value and nothing to buy in the game.
- Not affiliated with Nintendo, The Pokémon Company or Game Freak.
- Credit the PMDCollab sprites.
- Be upfront that the Featured Showcase has bot spectators.
- Never ask for upvotes. It breaks Product Hunt rules and most subreddit rules.

Replace `https://pokebets.fly.dev` if the domain changes.

Gameplay facts the copy below relies on, as the code has them (check again if the rules change):
- Every tab starts with $100 (`STARTING_BALANCE`, game-server/wallets.ts). The dev server shows a huge balance instead (`DEVELOPMENT_UNLIMITED_CASH`).
- Bets close 45 seconds into a match (`AGGRESSION_TRIGGER_MS`), and backers of the winner split the pot (parimutuel; a shared win at the 2-minute cap refunds everyone).
- Everyone still watching when a match ends gets $10 (`MATCH_WATCHED_REWARD`).
- The shop (src/net/shop.ts) sells a Potion ($40, +25% HP), a Super Potion ($90, +50% HP) and a Revive ($1,000). It is **one item per viewer per match**, with a small room-wide stock and at most 2 heals per fighter, and it only works on a room's full page. It heals *any* fighter, so it helps your pick but can't keep it alive on its own.
- Open (non-showcase) rooms have a JOIN ROOM button; a seated player picks their Pokémon in the lobby countdown (RoomLobbyScreen + SpeciesPicker). The Featured Showcase is spectate-only.
- The live grid already includes boss rooms and a 2v2 team room (game-server/server.ts), so don't pitch those as future modes.

## G1. Product Hunt
PH limits: tagline max 60 chars, description ≤260 chars, thumbnail 240×240, gallery 1270×760 (2 or more images; the first also becomes the social share image), images under 3MB, and no emoji in the name ([PH help](https://help.producthunt.com/en/articles/479557-how-to-post-a-product), [Submitator](https://submitator.com/blog/product-hunt-launch-assets)).

- **Name:** `PokéBets Arena`
- **Tagline (43/60):** `Bet play money on live Pokémon auto-battles`
  - Alternative (55/60): `Watch Pokémon auto-battle 24/7 and bet play money on it`
- **Description (221/260):** `A free, fan-made browser game where Pokémon auto-battle in free-for-all arenas around the clock. Watch live, chat, and bet play money on who is left standing. Winners split the pot. No sign-up, no download, no real money.`
- **Topics:** Games, Indie Games
- **Link:** `https://pokebets.fly.dev/`
- **Thumbnail (240×240):** pokeball.png at 6× (180×180, nearest-neighbor) centered on `#fdf6e3`, 30px padding.

**Maker first comment:**
> Hey Product Hunt!
>
> [CONFIRM] I kept watching those Pokémon auto-battle videos on TikTok and wanted to argue about who'd win *while it was happening*, with other people, and with something on the line. So I built PokéBets Arena.
>
> **How it works**
> • Open the site. A free-for-all battle is already running in the Featured Showcase.
> • Every tab starts with $100 in play money. Back a fighter in the first 45 seconds of a match.
> • If your pick is the last one standing, you split the pot with everyone else who backed it. Watching a full match also earns $10.
> • Chat with the room, spend play money on a Potion to heal your pick mid-fight (one item per match, while stock lasts), or grab a seat in an open room and send in your own Pokémon.
>
> **What it isn't:** real gambling. The money is play money with no cash value, and there's nothing to buy. It's a free, non-commercial fan project, not affiliated with Nintendo, The Pokémon Company or Game Freak. The pixel sprites come from the amazing PMDCollab SpriteCollab community (CC BY-NC).
>
> Full disclosure: the Featured Showcase has bot spectators, so chat and bets aren't empty at 3am.
>
> Built with React, Phaser 3 and a server-authoritative battle sim, running on Fly.io.
>
> Two questions I'd love your take on:
> 1. What would make you stay for a second match?
> 2. What should come next: tournaments, creating your own rooms, or something else?

**Gallery (1270×760, in this order):**
1. **Hero card:** the og-image composition re-laid-out at 1270×760, with the same panel centered and sprites flanking. It doubles as the PH share image.
2. **Desktop room mid-battle:** `#/room/room-6` at 1440×810 with the chat sidebar and the predictions panel showing odds, captured while a real (non-dev) wallet shows $100. The dev server shows $1,000,000,000 (`DEVELOPMENT_UNLIMITED_CASH`), so **capture from production or with NODE_ENV≠development**. Headline overlay: "Bet before the 45-second mark".
3. **Win moment:** the "{NAME} WINS!" banner with the chat reacting. Overlay: "Last one standing takes the pot".
4. **Mobile trio:** three 390px phone frames (landing hero, room with ticker and bets drawer, shop with Potions) on a `#fdf6e3` background. Overlay: "Plays great on your phone".
5. **Landing page:** the full desktop landing, with the live rooms grid showing real thumbnails. Overlay: "Always live. No sign-up."

Launch timing: PH days reset at 12:01am PT. Reply to every comment on launch day.

## G2. Reddit
General caveats:
- Reddit rules pages couldn't be fetched when this was drafted, so **read each subreddit's sidebar rules before posting**. The member counts below are rough and unverified.
- Many subreddits filter new or low-karma accounts, and the traditional guideline is about 1 self-promo post per 9 other contributions ([Medium: game marketing](https://medium.com/game-marketing/how-to-post-your-game-on-reddit-2049f613e1ed)).
- Space the posts out over several days, not the same hour. Stay in the comments for the first 2–3 hours.
- Link posts pull the OG card once, so deploy the metadata first.
- Don't use URL shorteners.

### 1. r/WebGames (~140k members; browser games with no downloads or sign-ups)
- Caveat: posting your own free browser game there is generally treated as original content, and the no-sign-up / no-download premise matches this game ([abhi sundu](https://abhisundu.com/posts/marketing-free-games/)). Check the sidebar for a required title tag or flair. Post as a **link post** straight to the game URL.
- Title: `PokéBets Arena: watch Pokémon auto-battle live and bet play money on the winner (free, no sign-up)`
- First comment:
> I made this! Pokémon fight free-for-all battles on their own, 24/7. You get $100 in play money (no real money, nothing to buy), back a fighter in the first 45 seconds, and if it's the last one standing you split the pot. There's live chat, a Potion you can buy with play money to heal a fighter mid-battle (one per match), and open rooms where you can take a seat and send in your own Pokémon.
>
> Works on phones too. The Featured Showcase has bot spectators so it's never dead. Free fan project, not affiliated with Nintendo/TPC/Game Freak; sprites by PMDCollab. Feedback very welcome, especially on what would make you stay for another match.

### 2. r/playmygame (~130k members; devs share freely playable games for feedback)
- Caveat: use the subreddit's own post flow and the platform flair (e.g. `[PC] (Web)`). The game must be free to play, and feedback threads are expected. Read the highlighted posts first, because new accounts posting links get filtered ([GummySearch](https://gummysearch.com/r/playmygame/)).
- Title: `[Web] PokéBets Arena: Pokémon auto-battle live, you bet play money on who survives`
- Body:
> **Play:** https://pokebets.fly.dev/ (browser, desktop or mobile, no sign-up)
>
> **What it is:** a spectator game. Pokémon fight free-for-all battles on their own around the clock. Everyone starts with $100 in play money; you back a fighter in the first 45 seconds and winners split the pot. Chat with the room, spend play money on a Potion to heal a fighter mid-battle, or grab a seat in an open room and pick your own fighter.
>
> **Not real gambling:** play money only, no cash value, nothing to buy.
>
> **Feedback I'm looking for:**
> 1. Is it clear what to do in the first 10 seconds?
> 2. Does betting feel fair and readable (odds, when bets close)?
> 3. What would make you stay for a second match?
>
> [CONFIRM] Solo project, free and non-commercial. Not affiliated with Nintendo, The Pokémon Company or Game Freak. Sprites by the PMDCollab SpriteCollab contributors. The showcase room has bot spectators so it isn't empty.

### 3. r/SideProject
- Caveat: self-promotion of real, working products is welcome, but a maker story and a live product are expected, not a waitlist. Engagement matters more than the link ([GrowReddit](https://www.growreddit.com/blog/reddit-self-promotion-rules-sideproject)). Use a **text post**.
- Title: `I built a site where Pokémon auto-battle 24/7 and people bet play money on the winner`
- Body:
> [CONFIRM] I kept watching Pokémon auto-battle clips on TikTok and wanted to watch them *live* with other people, with something riding on the result. So I built PokéBets Arena: https://pokebets.fly.dev/
>
> **How it plays:** a server runs free-for-all battles nonstop. Every visitor gets $100 in play money, bets close 45 seconds into a match, and winners split the pot (parimutuel). You also get $10 per match watched, and you can spend play money on a Potion to heal your pick mid-fight (one item per match).
>
> **Stack:** React 18 + Phaser 3 on the client, a server-authoritative battle sim streamed over SSE, PMDCollab pixel sprites, deployed on Fly.io.
>
> **Things I learned:**
> - [CONFIRM] An always-on showcase room with bot spectators made the first visit feel alive. (Being upfront about it: they're bots.)
> - [CONFIRM] Closing bets at 45s, when fighters get aggressive, stopped last-second sniping.
>
> It's free and non-commercial: play money only, nothing to buy, not affiliated with Nintendo/TPC/Game Freak. I'd love feedback on the first-10-seconds experience.

### 4. r/PokemonMysteryDungeon (the art comes from the PMD sprite community)
- Caveat: **rules unverified**. Many fan subs restrict self-promotion or require a flair or a specific day, so check the sidebar or message the mods first. Lead with credit to PMDCollab. **Avoid r/pokemon**: a huge generalist sub with strict spam and self-promo enforcement, where removal risk is high. Only post there if its current rules explicitly allow fan projects.
- Title: `I made a live auto-battle arena using the PMDCollab sprites. Pokémon fight 24/7 and you bet play money on who wins`
- Body:
> Huge thanks to the PMDCollab SpriteCollab contributors. Every fighter uses their sprites (CC BY-NC), and the idle, attack, hurt and faint animations are what make the battles readable.
>
> https://pokebets.fly.dev/ runs free-for-all battles nonstop. You start with $100 in play money (no real money, nothing to buy), back a fighter in the first 45 seconds, and split the pot if it's the last one standing.
>
> Free fan project, not affiliated with Nintendo, The Pokémon Company or Game Freak. If any sprite looks off in battle, tell me and I'll fix it.
