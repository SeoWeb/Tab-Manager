// Packages the built extension (build/) into a versioned .zip for upload to
// the Chrome Web Store. The zip mirrors the unpacked extension exactly —
// manifest.json sits at the zip root, which is what the Web Store expects.
//
// Run `pnpm run build` first so build/ is fresh, then `pnpm run package`.
// Reads the version from build/manifest.json so the zip name and the shipped
// manifest can never drift apart.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const distDir = path.join(root, 'dist');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function fail(msg) {
  console.error(`${RED}[package-zip] ${msg}${RESET}`);
  process.exit(1);
}

// Files excluded from the package: OS cruft, source maps (large + leak source),
// Next.js prerendered text exports, and dev-only debug routes. None are needed
// at runtime in the extension. Patterns are matched by zip against each entry's
// stored path, so the leading `*` covers files at any depth.
const EXCLUDES = [
  '*.DS_Store',
  '*Thumbs.db',
  '*.map',
  '*.txt',
  '*debug-favicons*',
  '*favicon-migration*',
];

function readVersion() {
  const manifestPath = path.join(buildDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    fail('build/manifest.json not found — run `pnpm run build` first.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.version) fail('No "version" field in build/manifest.json.');
  return manifest.version;
}

function hasBin(bin) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const version = readVersion();
const zipName = `tabspace-${version}.zip`;
const zipPath = path.join(distDir, zipName);

if (!hasBin('zip')) {
  fail('System `zip` binary not found. Install it (e.g. `sudo apt install zip`).');
}

fs.mkdirSync(distDir, { recursive: true });
// Remove a stale zip of the same version so the output always reflects this run.
if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

// `zip` stores entries relative to its cwd, so run it from inside build/ to put
// manifest.json at the archive root. -X strips extra file attributes for a
// cleaner, more reproducible archive.
const args = ['-r', '-X', zipPath, '.', ...EXCLUDES.map((x) => `-x${x}`)];
execFileSync('zip', args, { cwd: buildDir, stdio: 'inherit' });

const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
console.log(
  `${GREEN}[package-zip] Created ${path.relative(root, zipPath)} (${sizeKb} KB)${RESET}`,
);
