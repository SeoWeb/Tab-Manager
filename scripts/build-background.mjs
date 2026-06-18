// Bundles the background service worker (src/background/index.ts) into a single
// ESM file at build/background.js, resolving the `@/` path alias. Runs as part
// of the `build` script, after `next build` and before `post-build.js`.
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const entry = path.join(root, 'src', 'background', 'index.ts');
const buildDir = path.join(root, 'build');
const outfile = path.join(buildDir, 'background.js');

await fs.promises.mkdir(buildDir, { recursive: true });

// esbuild doesn't resolve tsconfig `paths`, so resolve `@/...` -> `src/...`
// here. Delegating to `build.resolve` (with resolveDir = src) lets esbuild apply
// its normal extension/index resolution instead of requiring an explicit .ts.
const srcDir = path.join(root, 'src');
const aliasAtPlugin = {
  name: 'alias-at',
  setup(build) {
    build.onResolve({ filter: /^@\// }, async (args) => {
      const result = await build.resolve('./' + args.path.slice(2), {
        kind: 'import-statement',
        resolveDir: srcDir,
      });
      if (result.errors.length > 0) {
        return { errors: result.errors };
      }
      return { path: result.path };
    });
  },
};

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outfile,
  plugins: [aliasAtPlugin],
  logLevel: 'info',
});

console.log('Bundled background service worker -> build/background.js');
