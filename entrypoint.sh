#!/bin/bash
# Symlinks the asset-mirror directories sprite-server/server.ts expects at
# the project root (../pmd-sprite-mirror/, ../sound-track/) onto the
# persistent Fly Volume mounted at /data, then runs sprite-server,
# game-server, and Caddy (reverse-proxying to both + serving dist/) together.
# If any one of the three dies, the whole container exits so Fly restarts it.
# Move SFX are no longer a mirror: the clips the game uses ship in the build
# under dist/move-sounds/ (see data-pipeline/build-move-sound-index.ts).
set -e

DATA_DIR=/data
for name in pmd-sprite-mirror sound-track; do
  mkdir -p "$DATA_DIR/$name"
  ln -sfn "$DATA_DIR/$name" "/app/$name"
done

# Both servers are single-file bundles (scripts/build-servers.mjs) — no
# node_modules or TypeScript runner in this image. The sprite server finds
# the mirrors at ../pmd-sprite-mirror and ../sound-track relative to its own
# file, i.e. the /app/<mirror> symlinks made above.
node dist-server/sprite-server.js &
sprite_pid=$!

node dist-server/game-server.js &
game_pid=$!

caddy run --config ./Caddyfile --adapter caddyfile &
caddy_pid=$!

trap 'kill $sprite_pid $game_pid $caddy_pid 2>/dev/null' TERM INT
wait -n "$sprite_pid" "$game_pid" "$caddy_pid"
