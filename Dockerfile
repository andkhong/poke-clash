# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine AS caddy

FROM node:22-slim AS runtime
WORKDIR /app

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/game-server ./game-server
COPY --from=build /app/sprite-server ./sprite-server
COPY --from=build /app/package.json ./package.json
COPY Caddyfile ./Caddyfile
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV PMD_SPRITE_SERVER_PORT=4310 \
    GAME_SERVER_PORT=4311

EXPOSE 8080
CMD ["./entrypoint.sh"]
