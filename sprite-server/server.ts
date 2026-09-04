import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Minimal standalone static-file server for the locally-mirrored PMDCollab
// sprite art (see data-pipeline/fetch-pmd-sprites.ts). Runs as its own
// process/port so the (large, gitignored) sprite mirror never has to live
// under Vite's public/ dir or get bundled into the app. In dev, Vite proxies
// /pmd-sprites/* to this server (see vite.config.ts) so client code just
// fetches root-relative URLs, same as it already does for /cries/*.
const PORT = Number(process.env.PMD_SPRITE_SERVER_PORT ?? 4310);
const MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;

// Strict allowlist for both path segments — this is what actually prevents
// path traversal (../../etc/passwd-style requests), since the matched groups
// are joined straight onto a filesystem path below. The optional "-shiny"
// suffix matches fetch-pmd-shiny-sprites.ts's mirror folder naming
// ("{id}-shiny/"), so the exact same route serves both tiers.
const ROUTE_RE = /^\/pmd-sprites\/([0-9]{4}(?:-shiny)?)\/([A-Za-z]+-(?:Anim|Shadow)\.png)$/;

const server = createServer((req, res) => {
  const url = req.url ?? '';

  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('pmd sprite server ok');
    return;
  }

  const match = ROUTE_RE.exec(url);
  if (!match) {
    res.writeHead(404).end('not found');
    return;
  }

  const [, speciesDir, file] = match;
  const filePath = join(MIRROR_ROOT, speciesDir, file);

  readFile(filePath)
    .then((data) => {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404).end('not found');
    });
});

server.listen(PORT, () => {
  console.log(`[sprite-server] serving ${MIRROR_ROOT} at http://localhost:${PORT}`);
});
