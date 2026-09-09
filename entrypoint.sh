#!/bin/bash
# Symlinks the three asset-mirror directories sprite-server/server.ts expects
# at the project root (../pmd-sprite-mirror/, ../sound/, ../sound-track/) onto
# the persistent Fly Volume mounted at /data, then runs sprite-server,
# game-server, and Caddy (reverse-proxying to both + serving dist/) together.
# If any one of the three dies, the whole container exits so Fly restarts it.
set -e

DATA_DIR=/data
for name in pmd-sprite-mirror sound sound-track; do
  mkdir -p "$DATA_DIR/$name"
  ln -sfn "$DATA_DIR/$name" "/app/$name"
done

node_modules/.bin/tsx sprite-server/server.ts &
sprite_pid=$!

node_modules/.bin/tsx game-server/server.ts &
game_pid=$!

caddy run --config ./Caddyfile --adapter caddyfile &
caddy_pid=$!

trap 'kill $sprite_pid $game_pid $caddy_pid 2>/dev/null' TERM INT
wait -n "$sprite_pid" "$game_pid" "$caddy_pid"
