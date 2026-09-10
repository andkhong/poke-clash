// Bundles the two Node servers into single self-contained ESM files under
// dist-server/, so the production image runs them with plain `node` and
// ships no node_modules and no TypeScript runner at all (they used to run
// from source via tsx, which meant copying the full 320 MB dev
// node_modules into the runtime image). Each bundle includes its npm
// dependencies (music-metadata for the sprite server; the sim + generated
// dataset for the game server); Node's own modules stay external.
//
// Output is flat (dist-server/<name>.js) on purpose: sprite-server/server.ts
// resolves its mirror directories relative to its own file
// (`new URL('../pmd-sprite-mirror/', import.meta.url)`), so the bundle has
// to sit one directory below the project root exactly like the source does.
import { build } from 'esbuild';

const SERVERS = ['game-server', 'sprite-server'];

for (const name of SERVERS) {
  await build({
    entryPoints: [`${name}/server.ts`],
    outfile: `dist-server/${name}.js`,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    logLevel: 'warning',
    // CommonJS dependencies inside an ESM bundle need a `require` to exist
    // (esbuild leaves calls to it in place); Node's createRequire provides one.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  });
  console.log(`[build-servers] wrote dist-server/${name}.js`);
}
