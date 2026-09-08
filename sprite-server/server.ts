import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

// Minimal standalone static-file server for locally-mirrored, gitignored
// binary asset mirrors: PMDCollab sprite art (see
// data-pipeline/fetch-pmd-sprites.ts), the user-supplied move-SFX mirror
// (see data-pipeline/build-move-sound-index.ts), and the user-supplied
// background-music mirror (sound-track/<pack>/*.mp3, e.g. "emerald",
// "red-blue" — see the /soundtracks routes below). Runs as its own
// process/port so none of these mirrors ever has to live under Vite's
// public/ dir or get bundled into the app. In dev, Vite proxies
// /pmd-sprites/*, /move-sounds/* and /soundtracks/* to this server (see
// vite.config.ts) so client code just fetches root-relative URLs, same as
// it already does for /cries/*.
const PORT = Number(process.env.PMD_SPRITE_SERVER_PORT ?? 4310);
const SPRITE_MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;
const SOUND_MIRROR_ROOT = new URL('../sound/', import.meta.url).pathname;
const SOUNDTRACK_MIRROR_ROOT = new URL('../sound-track/', import.meta.url).pathname;

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

// Unlike the move-SFX mirror's fixed 7 generation folders, sound-track/'s
// packs (currently "emerald" and "red-blue") aren't known ahead of time —
// the whole point is that dropping in a new pack directory picks it up
// automatically, with no code change or rebuild step. So both routes below
// list the mirror's actual directory contents on every request instead of
// checking against a hardcoded allowlist or regex charset; that directory
// listing doubles as the path-traversal defense (a folder/file segment can
// only resolve to a real entry readdir() just returned, so "../" and similar
// never reach the filesystem join below) and as the freshness mechanism (no
// server restart needed to see a newly added pack or track).
const SOUNDTRACK_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav']);
const SOUNDTRACK_ROUTE_RE = /^\/soundtracks\/track\/([^/]+)\/([^/]+)$/;

interface SoundtrackTrack {
  folder: string;
  file: string;
}

async function listSoundtrackFolders(): Promise<string[]> {
  const entries = await readdir(SOUNDTRACK_MIRROR_ROOT, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listSoundtrackFiles(folder: string): Promise<string[]> {
  const entries = await readdir(join(SOUNDTRACK_MIRROR_ROOT, folder), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && SOUNDTRACK_EXTENSIONS.has(extname(e.name).toLowerCase()))
    // "(Unused)" tracks in the Emerald pack are leftover/broken jingles, not
    // real background music — worth skipping rather than letting a match
    // randomly land on one.
    .filter((e) => !/\(unused\)/i.test(e.name))
    .map((e) => e.name);
}

async function listAllSoundtrackTracks(): Promise<SoundtrackTrack[]> {
  const folders = await listSoundtrackFolders();
  const perFolder = await Promise.all(
    folders.map(async (folder) => (await listSoundtrackFiles(folder)).map((file) => ({ folder, file })))
  );
  return perFolder.flat();
}

function soundtrackTrackUrl(track: SoundtrackTrack): string {
  return `/soundtracks/track/${encodeURIComponent(track.folder)}/${encodeURIComponent(track.file)}`;
}

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

function soundtrackContentType(file: string): string {
  const ext = extname(file).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'audio/mpeg';
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

  // Picks the random track server-side (rather than handing the client the
  // full catalog to pick from) so the catalog itself — which packs and
  // tracks currently exist on disk — never has to be duplicated into
  // frontend code or a generated index that could go stale as packs are
  // added.
  if (url === '/soundtracks/random') {
    listAllSoundtrackTracks().then((tracks) => {
      if (tracks.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'no tracks' }));
        return;
      }
      const track = tracks[Math.floor(Math.random() * tracks.length)];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ folder: track.folder, file: track.file, url: soundtrackTrackUrl(track) }));
    });
    return;
  }

  const soundtrackMatch = SOUNDTRACK_ROUTE_RE.exec(url);
  if (soundtrackMatch) {
    const [, folder, file] = soundtrackMatch;
    Promise.all([listSoundtrackFolders(), listSoundtrackFiles(folder)]).then(([folders, files]) => {
      if (!folders.includes(folder) || !files.includes(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      serveFile(res, join(SOUNDTRACK_MIRROR_ROOT, folder, file), soundtrackContentType(file));
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(
    `[sprite-server] serving ${SPRITE_MIRROR_ROOT}, ${SOUND_MIRROR_ROOT} and ${SOUNDTRACK_MIRROR_ROOT} at http://localhost:${PORT}`
  );
});
