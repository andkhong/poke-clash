# Deploying

The app is one Fly machine running Caddy (static build + reverse proxy),
the game server and the sprite server, with the large asset mirrors on a
Fly volume mounted at `/data`. The image contains no mirrors and no
`node_modules`.

## What lives where

| Asset | Source (local, gitignored) | Prepared by | Ships in |
|---|---|---|---|
| Move SFX (463 clips, 16 MB) | `sound/` | `npm run data:build-move-sounds` | the repo and image (`public/move-sounds/`) |
| Cries (16 MB) | — | `npm run data:fetch-cries` | the repo and image (`public/cries/`) |
| Sprite sheets (55 MB) | `pmd-sprite-mirror/` | `npm run data:optimize-pmd-sprites` | the volume, `/data/pmd-sprite-mirror` |
| Music (225 MB) | `sound-track/` | `npm run data:build-soundtrack` | the volume, `/data/sound-track` |

The three pipeline scripts need `ffmpeg` on `PATH` (the sprite optimizer
uses `sharp`, installed with the dev dependencies). Each one only
re-processes inputs that changed since the last run; pass `--force` to
redo everything. Their output is `deploy-assets/`, which is exactly the
tree the volume should contain.

## Preparing and uploading the volume

```sh
npm run data:optimize-pmd-sprites
npm run data:build-soundtrack
tar -C deploy-assets -czf deploy-assets.tar.gz pmd-sprite-mirror sound-track

fly ssh sftp shell            # then, at the sftp prompt:
#   put deploy-assets.tar.gz /data/deploy-assets.tar.gz
fly ssh console -C "sh -c 'cd /data && tar -xzf deploy-assets.tar.gz && rm deploy-assets.tar.gz'"
```

Uploading replaces files in place; nothing in the image caches them, so
the new assets are live immediately. If the sprite sheets changed in
pixels or frame layout (a re-fetch from PMDCollab, or a change to the
optimizer's output), bump `PMD_SHEET_VERSION` in
`src/render/sprites/pmdSheetUrl.ts` before deploying the app: sheet URLs
are cached immutably for a year, keyed by that tag.

## Building and deploying the app

```sh
npm run data:build-move-sounds   # only if sound/ or the move dataset changed
fly deploy
```

`fly deploy` builds the image: `npm run build` (Vite) and
`npm run build:servers` (esbuild bundles of both servers). To test the
image locally with the prepared assets standing in for the volume:

```sh
docker build -t poke-clash .
docker run --rm -p 8080:8080 -v "$PWD/deploy-assets:/data:ro" poke-clash
```

## Caching and delivery

Caddy sets `Cache-Control` per path (see `Caddyfile`): the hashed Vite
bundle and the versioned sprite sheets are immutable for a year, cries,
move sounds and soundtrack files for a month, and `index.html` is always
revalidated. Sprite sheets and soundtrack files are served by Caddy's
file server straight from the volume, so byte-range requests (music is
streamed), ETags and compression all work without going through Node; the
sprite server's only production duty is `/soundtracks/random`.

Everything is one machine in one region. Two options when that stops
being enough, both compatible with the paths and headers above:

- **A CDN in front of the app** (Cloudflare or similar, proxying the Fly
  hostname). It will honor the cache headers as they are; the only thing
  worth adding is a rule to cache `/pmd-sprites/*`, `/soundtracks/track/*`,
  `/cries/*` and `/move-sounds/*` at the edge. This removes almost all
  asset traffic from the machine with no code change.
- **Object storage for the mirrors** (Tigris via `fly storage`, or R2),
  uploaded from `deploy-assets/` with the same directory layout, and
  Caddy's two `handle_path` blocks pointed at the bucket's public URL
  with `reverse_proxy` instead of `file_server`. This drops the volume,
  so the app can run on more than one machine and in more than one
  region. Keep the `Cache-Control` headers on the objects.
