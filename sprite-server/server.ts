import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import { parseByteRange } from './byteRange';

// Minimal standalone static-file server for locally-mirrored, gitignored
// binary asset mirrors: PMDCollab sprite art (see
// data-pipeline/fetch-pmd-sprites.ts) and the user-supplied background-music
// mirror (sound-track/<pack>/*.mp3, e.g. "emerald", "red-blue" — see the
// /soundtracks routes below). Runs as its own process/port so neither
// mirror ever has to live under Vite's public/ dir or get bundled into the
// app. In dev, Vite proxies /pmd-sprites/* and /soundtracks/* to this
// server (see vite.config.ts) so client code just fetches root-relative
// URLs, same as it already does for /cries/* and /move-sounds/* (both of
// which are plain static files under public/ — the move SFX used to be a
// third mirror here, see data-pipeline/build-move-sound-index.ts).
const PORT = Number(process.env.PMD_SPRITE_SERVER_PORT ?? 4310);
const SPRITE_MIRROR_ROOT = new URL('../pmd-sprite-mirror/', import.meta.url).pathname;
const SOUNDTRACK_MIRROR_ROOT = new URL('../sound-track/', import.meta.url).pathname;

// Strict allowlist for both path segments — this is what actually prevents
// path traversal (../../etc/passwd-style requests), since the matched groups
// are joined straight onto a filesystem path below. The optional "-shiny"
// suffix matches fetch-pmd-shiny-sprites.ts's mirror folder naming
// ("{id}-shiny/"), so the exact same route serves both tiers.
const SPRITE_ROUTE_RE = /^\/pmd-sprites\/([0-9]{4}(?:-shiny)?)\/([A-Za-z]+-(?:Anim|Shadow)\.png)$/;

// Unlike the sprite mirror's fixed folder naming, sound-track/'s
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

// A 90s match easily outlasts a jingle-length track (the "Obtained an Item!"/
// "Obtained a Berry!" stingers in the Emerald pack are 3-6s), so a random
// pick landing on one would loop jarringly every few seconds for most of a
// match — excluded from the random pool entirely rather than tuned around.
const MIN_TRACK_DURATION_SECONDS = 10;

// Duration requires actually parsing each file's audio headers (cheap per
// file, but adds up across the whole catalog), so results are cached
// in-memory forever, same "immutable, served forever" assumption as the
// Cache-Control header below — a track's own audio data isn't expected to
// change while the server is running. Keyed by "folder/file" since file
// names alone aren't unique across packs.
const trackDurationCache = new Map<string, number | null>();

/** Seconds, or null if the file couldn't be parsed (treated as excluded from
 * random selection — better to skip a track than risk playing something
 * whose real length we don't actually know). */
async function getTrackDurationSeconds(folder: string, file: string): Promise<number | null> {
  const cacheKey = `${folder}/${file}`;
  const cached = trackDurationCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const duration = await parseFile(join(SOUNDTRACK_MIRROR_ROOT, folder, file))
    .then((meta) => meta.format.duration ?? null)
    .catch(() => null);
  trackDurationCache.set(cacheKey, duration);
  return duration;
}

async function listAllSoundtrackTracks(): Promise<SoundtrackTrack[]> {
  const folders = await listSoundtrackFolders();
  const perFolder = await Promise.all(
    folders.map(async (folder) => (await listSoundtrackFiles(folder)).map((file) => ({ folder, file })))
  );
  const candidates = perFolder.flat();

  const durations = await Promise.all(candidates.map((t) => getTrackDurationSeconds(t.folder, t.file)));
  return candidates.filter((_, i) => (durations[i] ?? 0) >= MIN_TRACK_DURATION_SECONDS);
}

/** Best-effort warm-up so the first real /soundtracks/random request doesn't
 * pay for parsing the whole catalog's durations serially — failures here are
 * harmless, getTrackDurationSeconds() re-tries (and caches) on demand anyway. */
async function primeSoundtrackDurationCache(): Promise<void> {
  const folders = await listSoundtrackFolders();
  for (const folder of folders) {
    const files = await listSoundtrackFiles(folder);
    await Promise.all(files.map((file) => getTrackDurationSeconds(folder, file)));
  }
}

function soundtrackTrackUrl(track: SoundtrackTrack): string {
  return `/soundtracks/track/${encodeURIComponent(track.folder)}/${encodeURIComponent(track.file)}`;
}

// Streams from disk rather than reading the whole file into memory, and
// honors single byte ranges: the client streams music through an <audio>
// element now (see src/render/sound/battleMusic.ts), and browsers — Safari
// in particular — will only stream (and seek) media from a server that
// answers Range requests with 206s. Sprites and everything else get the
// same treatment for free.
function serveFile(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  filePath: string,
  contentType: string
): void {
  stat(filePath)
    .then((info) => {
      if (!info.isFile()) throw new Error('not a file');
      const headers: Record<string, string | number> = {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const range = parseByteRange(req.headers.range, info.size);
      if (req.headers.range && !range) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      if (range) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        headers['Content-Length'] = range.end - range.start + 1;
        res.writeHead(206, headers);
        createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      } else {
        headers['Content-Length'] = info.size;
        res.writeHead(200, headers);
        createReadStream(filePath).pipe(res);
      }
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
  // Path only: sheet URLs carry a cache-busting ?v= tag (see
  // src/render/sprites/pmdSheetUrl.ts) that the routes below must ignore.
  const url = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);

  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('pmd sprite server ok');
    return;
  }

  const spriteMatch = SPRITE_ROUTE_RE.exec(url);
  if (spriteMatch) {
    const [, speciesDir, file] = spriteMatch;
    serveFile(req, res, join(SPRITE_MIRROR_ROOT, speciesDir, file), 'image/png');
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
      serveFile(req, res, join(SOUNDTRACK_MIRROR_ROOT, folder, file), soundtrackContentType(file));
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, () => {
  console.log(
    `[sprite-server] serving ${SPRITE_MIRROR_ROOT} and ${SOUNDTRACK_MIRROR_ROOT} at http://localhost:${PORT}`
  );
});

void primeSoundtrackDurationCache();
