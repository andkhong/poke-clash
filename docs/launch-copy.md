# Pokémon Brawl: launch copy

Draft. Lines marked [CONFIRM] are placeholders to check before posting.

The pitch: **You fight. The crowd calls it.** Real-time Pokémon brawls in the browser: you control one Pokémon, and everyone watching votes on what help lands next. (The old AI-only "live games" with an always-on showcase room and bot spectators are gone, so don't mention them.)

Framing rules for every post:
- Free. No account, no download.
- Non-commercial fan project.
- **Play money only**, with no cash value and nothing to buy in the game.
- Not affiliated with Nintendo, The Pokémon Company or Game Freak.
- Credit the PMDCollab sprites.
- No invented numbers: no player counts or "thousands of matches" unless they come from real data.
- Never ask for upvotes. It breaks Product Hunt rules and most subreddit rules.

Gameplay facts the copy below relies on, as the code has them (check again if the rules change):
- Play Mode: you control one Pokémon. Move (WASD or the touch joystick), aim, four moves, a dash, one KO and you're out (no respawns; a spectator's Revive can bring a fighter back), 3-minute matches (`ACTION_MATCH_LIMIT_MS`, src/sim/action/rules.ts). Gens 1–4, national dex up to 493 (`PLAY_IDS`, src/app/playMode.ts).
- Modes: 1v1, 2v2, 3v3, 4v4 and Brawl, a free-for-all for up to 8 (`PLAY_MODES`, key `'ffa'`). Bots fill every empty seat when a match starts.
- Solo vs bots needs no server (Play now). Online rooms are at `#/play`: pick a room or create one, share the link, and bots hold the open seats.
- The crowd: anyone can watch a room, sign up with a display name (no account), chat, bet play money and buy potions.
- Crowd Calls (src/net/play/playProtocol.ts): in team matches, every 30 seconds (first at 0:20) each side's crowd is offered three of four cards (Speed Burst, Shield, Energy Refill, Supply Drop) and votes for 10 seconds. The winner lands on that side's fighters 2 seconds after the vote closes. No votes means a random "house pick". Fighters never vote. Brawl has no Crowd Calls yet, so don't promise any.
- Every tab starts with $100 (`STARTING_BALANCE`, game-server/wallets.ts); everyone watching when a match ends gets $10 (`MATCH_WATCHED_REWARD`). The dev server shows a huge balance instead (`DEVELOPMENT_UNLIMITED_CASH`).

## G1. Product Hunt
PH limits: tagline max 60 chars, description ≤260 chars, thumbnail 240×240, gallery 1270×760 (2 or more images; the first also becomes the social share image), images under 3MB, and no emoji in the name ([PH help](https://help.producthunt.com/en/articles/479557-how-to-post-a-product), [Submitator](https://submitator.com/blog/product-hunt-launch-assets)).

- **Name:** `Pokémon Brawl`
- **Tagline (56/60):** `Real-time Pokémon brawls where the crowd calls the shots`
  - Alternative (30/60): `You fight. The crowd calls it.`
- **Description (230/260):** `A free, fan-made browser game: control a Pokémon in real-time brawls, 1v1 to 4v4 or an 8-player Brawl. Play solo vs bots or online. Everyone watching votes every 30 seconds on what help lands on their side next. No account, no download.`
- **Topics:** Games, Indie Games
- **Link:** `https://pokemonbrawl.com/`
- **Thumbnail (240×240):** pokeball.png at 6× (180×180, nearest-neighbor) centered on `#dde9f2`, 30px padding.

**Maker first comment:**
> Hey Product Hunt!
>
> [CONFIRM] I wanted Pokémon battles that feel like a brawler, not a menu, and I wanted the people watching to matter. So I built Pokémon Brawl.
>
> **How it works**
> • Hit Play now and you're in a match against bots in seconds. Move, dodge, aim four moves, dash, and stay standing — one KO and you're out.
> • Play online: open a room, share the link, and bots hold the empty seats until friends arrive. 1v1 up to 4v4, or a free-for-all for 8.
> • Or watch and join the crowd: pick a name (no account), chat, bet play money, and every 30 seconds vote in a Crowd Call. The winning card (Speed Burst, Shield, Energy Refill or Supply Drop) lands on your side two seconds later, and both teams see it coming.
>
> **What it isn't:** real gambling. The money is play money with no cash value, and there's nothing to buy. It's a free, non-commercial fan project, not affiliated with Nintendo, The Pokémon Company or Game Freak. The pixel sprites come from the amazing PMDCollab SpriteCollab community (CC BY-NC).
>
> Built with React, Phaser 3 and a server-authoritative real-time sim over WebSockets, running on Fly.io.
>
> Two questions I'd love your take on:
> 1. Does the crowd feel like it matters in a match?
> 2. What should come next: more Pokémon, ranked matches, or something else?

**Gallery (1270×760, in this order):**
1. **Hero card:** the og-image composition re-laid-out at 1270×760. It doubles as the PH share image. [CONFIRM] the og-image still shows the old watch-and-bet pitch; re-make it for Play Mode.
2. **Desktop match mid-fight:** a 2v2 online room at 1440×810 during a Crowd Call vote. Overlay: "The crowd calls it".
3. **Crowd Call landing:** the "crowd called SHIELD" moment on one team. Overlay: "Every 30 seconds, the stands vote".
4. **Mobile trio:** three 390px phone frames (landing hero, a match with the touch joystick, the crowd drawer with votes and bets) on a `#dde9f2` background. Overlay: "Plays great on your phone".
5. **Landing page:** the full desktop landing with the open-rooms list. Overlay: "Free. No account. Bots fill empty seats."

Launch timing: PH days reset at 12:01am PT. Reply to every comment on launch day.

## G2. Reddit
General caveats:
- Read each subreddit's sidebar rules before posting. Member counts are rough and unverified.
- Many subreddits filter new or low-karma accounts, and the traditional guideline is about 1 self-promo post per 9 other contributions ([Medium: game marketing](https://medium.com/game-marketing/how-to-post-your-game-on-reddit-2049f613e1ed)).
- Space the posts out over several days. Stay in the comments for the first 2–3 hours.
- Link posts pull the OG card once, so deploy the metadata first.
- Don't use URL shorteners.
- Online rooms only feel alive with people in them: post when you can sit in a room yourself, and link the room in the comments.

### 1. r/WebGames (~140k members; browser games with no downloads or sign-ups)
- Caveat: check the sidebar for a required title tag or flair. Post as a **link post** straight to the game URL.
- Title: `Pokémon Brawl: real-time Pokémon brawls in the browser, and the crowd votes on what lands next (free, no sign-up)`
- First comment:
> I made this! You control one Pokémon in a real-time match: move, dodge, aim four moves, dash, one KO and you're out. Play solo against bots, or open an online room (1v1 to 4v4, or an 8-player Brawl) and share the link; bots fill any empty seats.
>
> Anyone watching can join the crowd: pick a name, chat, bet play money (no real money, nothing to buy), and vote every 30 seconds on a card that lands on their side, like a Shield or a Speed Burst.
>
> Works on phones (touch joystick). Free fan project, not affiliated with Nintendo/TPC/Game Freak; sprites by PMDCollab. Feedback very welcome, especially on controls.

### 2. r/playmygame (~130k members; devs share freely playable games for feedback)
- Caveat: use the subreddit's own post flow and the platform flair (e.g. `[PC] (Web)`). Read the highlighted posts first, because new accounts posting links get filtered ([GummySearch](https://gummysearch.com/r/playmygame/)).
- Title: `[Web] Pokémon Brawl: real-time Pokémon battles where the spectators vote in power-ups`
- Body:
> **Play:** https://pokemonbrawl.com/ (browser, desktop or mobile, no sign-up)
>
> **What it is:** a real-time arena brawler with Pokémon from Gens 1–4. WASD or a touch joystick to move, four moves to aim, a dash, one KO and you're out, three-minute matches. Solo vs bots or online rooms up to 4v4 or an 8-player Brawl.
>
> **The twist:** spectators are part of the game. Every 30 seconds in a team match, each side's crowd votes on one of three cards (Speed Burst, Shield, Energy Refill, Supply Drop), and it lands on their fighters two seconds later.
>
> **Feedback I'm looking for:**
> 1. Do the controls feel good on your device?
> 2. Is it clear what the Crowd Call did and when?
> 3. What would make you play a second match?
>
> [CONFIRM] Solo project, free and non-commercial, play money only. Not affiliated with Nintendo, The Pokémon Company or Game Freak. Sprites by the PMDCollab SpriteCollab contributors.

### 3. r/SideProject
- Caveat: self-promotion of real, working products is welcome, but a maker story and a live product are expected ([GrowReddit](https://www.growreddit.com/blog/reddit-self-promotion-rules-sideproject)). Use a **text post**.
- Title: `I built a real-time Pokémon brawler where the people watching vote on what help each team gets`
- Body:
> [CONFIRM] I wanted Pokémon battles you actually play with your thumbs, and I wanted spectators to matter instead of just watching. So I built Pokémon Brawl: https://pokemonbrawl.com/
>
> **How it plays:** you control one Pokémon: move, aim four moves, dash, one KO and you're out. Play solo vs bots or online with friends; bots hold open seats. Viewers sign up with just a name, chat, bet play money, and vote in a "Crowd Call" every 30 seconds that drops a Shield, Speed Burst, Energy Refill or Supply Drop on their side.
>
> **Stack:** React 18 + Phaser 3 on the client, a server-authoritative real-time sim over WebSockets, PMDCollab pixel sprites, deployed on Fly.io.
>
> **Things I learned:**
> - [CONFIRM] Landing the crowd's card two seconds after the vote, with a visible countdown, made it feel fair to the other team.
> - [CONFIRM] Filling empty seats with bots means a match starts in seconds, even with nobody else online.
>
> It's free and non-commercial: play money only, nothing to buy, not affiliated with Nintendo/TPC/Game Freak. I'd love feedback on the controls.

### 4. r/PokemonMysteryDungeon (the art comes from the PMD sprite community)
- Caveat: **rules unverified**. Many fan subs restrict self-promotion or require a flair or a specific day, so check the sidebar or message the mods first. Lead with credit to PMDCollab. **Avoid r/pokemon**: strict spam and self-promo enforcement, high removal risk.
- Title: `I made a real-time Pokémon brawler with the PMDCollab sprites. You fight, and the crowd votes on power-ups`
- Body:
> Huge thanks to the PMDCollab SpriteCollab contributors. Every fighter uses their sprites (CC BY-NC), and the walk, attack, hurt and faint animations are what make the fights readable.
>
> https://pokemonbrawl.com/ is a real-time arena brawler with Pokémon from Gens 1–4: you control one Pokémon, solo vs bots or online, and spectators vote every 30 seconds on a card that lands on their team.
>
> Free fan project, play money only, not affiliated with Nintendo, The Pokémon Company or Game Freak. If any sprite looks off in battle, tell me and I'll fix it.
