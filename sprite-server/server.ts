import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Minimal standalone static-file server for locally-mirrored, gitignored
// binary asset mirrors: PMDCollab sprite art (see
// data-pipeline/fetch-pmd-sprites.ts) and the user-supplied move-SFX mirror
// (see data-pipeline/build-move-sound-index.ts). Runs as its own
// process/port so neither mirror ever has to live under Vite's public/ dir
// or get bundled into the app. In dev, Vite proxies /pmd-sprites/* and
// /move-sounds/* to this server (see vite.config.ts) so client code just
// fetches root-relative URLs, same as it already does for /cries/*.
const PORT = Number(process.env.PMD_SPRITE_SERVER_PORT ?? 4310);
const SPRITE_MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;
const SOUND_MIRROR_ROOT = new URL('../sound/', import.meta.url).pathname;

// Strict allowlist for both path segments — this is what actually prevents
// path traversal (../../etc/passwd-style requests), since the matched groups
// are joined straight onto a filesystem path below. The optional "-shiny"
// suffix matches fetch-pmd-shiny-sprites.ts's mirror folder naming
// ("{id}-shiny/"), so the exact same route serves both tiers.
const SPRITE_ROUTE_RE = /^\/pmd-sprites\/([0-9]{4}(?:-shiny)?)\/([A-Za-z]+-(?:Anim|Shadow)\.png)$/;

// The move-sound mirror's own folder/file names (chosen by whoever packaged
// it, not by this project) contain spaces, commas, parentheses etc., so
// unlike the sprite route this can't be a tight character-class regex — the
// folder segment is instead checked against an exact allowlist of the 7
// known generation folder names, and the filename against a charset that
// covers everything actually present while still excluding "/" and "..".
const SOUND_GENERATION_FOLDERS = new Set([
  'GEN 1 SFX - Attack Moves - RBY',
  'GEN 2 SFX - Attack Moves - GSC',
  'GEN 3 SFX - Attack Moves - RSE, FR, LG',
  'GEN 4 SFX - Attack Moves - DPPL, HG, SS',
  'GEN 5 SFX - Attack Moves - BLK, WHT, BLK2, WHT2',
  'GEN 6 SFX - Attack Moves - XY, ORAS',
  'GEN 7 SFX - Attack Moves - SUMO, USUM',
]);
const SOUND_ROUTE_RE = /^\/move-sounds\/([^/]+)\/([A-Za-z0-9 '.,_()+-]+\.(?:mp3|wav))$/i;

function serveFile(res: import('node:http').ServerResponse, filePath: string, contentType: string): void {
  readFile(filePath)
    .then((data) => {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404).end('not found');
    });
}

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url ?? '');

  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('pmd sprite server ok');
    return;
  }

  const spriteMatch = SPRITE_ROUTE_RE.exec(url);
  if (spriteMatch) {
    const [, speciesDir, file] = spriteMatch;
    serveFile(res, join(SPRITE_MIRROR_ROOT, speciesDir, file), 'image/png');
    return;
  }

  const soundMatch = SOUND_ROUTE_RE.exec(url);
  if (soundMatch) {
    const [, folder, file] = soundMatch;
    if (!SOUND_GENERATION_FOLDERS.has(folder)) {
      res.writeHead(404).end('not found');
      return;
    }
    const contentType = file.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    serveFile(res, join(SOUND_MIRROR_ROOT, folder, file), contentType);
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(`[sprite-server] serving ${SPRITE_MIRROR_ROOT} and ${SOUND_MIRROR_ROOT} at http://localhost:${PORT}`);
});
