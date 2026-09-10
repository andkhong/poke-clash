// Writes a .br (brotli) and .gz sibling next to every compressible file in
// dist/ after `vite build`, so Caddy's `file_server { precompressed br gzip }`
// (see Caddyfile) can hand out the pre-made bytes instead of re-encoding the
// same ~3.6 MB bundle on every request — and at brotli quality 11, which is
// far too slow to run per request but ~15% smaller than on-the-fly gzip.
// Media and images are already compressed and are skipped.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;
const COMPRESSIBLE = /\.(js|mjs|css|html|json|svg|txt|map|xml|webmanifest)$/i;
const MIN_BYTES = 1024;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const files = (await walk(DIST)).filter((f) => COMPRESSIBLE.test(f));
let raw = 0;
let br = 0;
let gz = 0;
let count = 0;
for (const file of files) {
  const { size } = await stat(file);
  if (size < MIN_BYTES) continue;
  const data = await readFile(file);
  const brotli = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  const gzip = gzipSync(data, { level: 9 });
  await Promise.all([writeFile(`${file}.br`, brotli), writeFile(`${file}.gz`, gzip)]);
  raw += data.length;
  br += brotli.length;
  gz += gzip.length;
  count += 1;
}
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`[precompress-dist] ${count} files: ${mb(raw)} MB raw -> ${mb(br)} MB brotli, ${mb(gz)} MB gzip`);
