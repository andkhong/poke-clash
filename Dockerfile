# syntax=docker/dockerfile:1

# Build stage: dev dependencies are needed here (tsc, vite, esbuild), but
# nothing from node_modules reaches the runtime image — the client is a
# static build and both servers are bundled to single files
# (scripts/build-servers.mjs). The asset mirrors are not part of the image
# either: they live on the Fly volume (see entrypoint.sh and .dockerignore).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:servers

FROM caddy:2-alpine AS caddy

FROM node:22-slim AS runtime
WORKDIR /app

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY Caddyfile ./Caddyfile
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production \
    PMD_SPRITE_SERVER_PORT=4310 \
    GAME_SERVER_PORT=4311

EXPOSE 8080
CMD ["./entrypoint.sh"]
