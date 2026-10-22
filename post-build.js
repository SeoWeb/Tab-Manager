const fs = require('node:fs/promises');
const path = require('path');

const buildDir = path.join(__dirname, 'build');
const publicDir = path.join(__dirname, 'public');

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

//1. Copy manifest.json from public to build and sync its version with package.json
async function copyManifest() {
  const src = path.join(publicDir, 'manifest.json');
  const dest = path.join(buildDir, 'manifest.json');
  await fs.mkdir(buildDir, { recursive: true });
  await fs.copyFile(src, dest);
  console.log('Copied manifest.json to build directory.');

  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await fs.readFile(dest, 'utf8'));
  manifest.version = pkg.version;
  await fs.writeFile(dest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Synced manifest.json version to ${pkg.version} from package.json.`);
}

//2. Replace /_next/ with ./ in all HTML, CSS, and JS files
async function fixPaths(dir) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await fixPaths(filePath);
    } else if (/\.(html|css|js)$/.test(filePath)) {
      let content = await fs.readFile(filePath, 'utf8');
      content = content.replace(/\/_next\//g, './next/');
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
}

// Matches a <script> tag, capturing its attribute string and its body. The
// attribute pattern allows quoted values containing ">" so only a real
// tag-ending ">" closes the capture.
const SCRIPT_TAG_REGEX = /<script\b((?:"[^"]*"|'[^']*'|[^">])*)>([\s\S]*?)<\/script>/gi;

//3. Externalize inline scripts and update CSP
async function externalizeScriptsAndUpdateCsp() {
  const htmlPath = path.join(buildDir, 'index.html');
  if (!(await pathExists(htmlPath))) {
    console.log('index.html not found. Skipping script externalization.');
    return;
  }

  const scriptsDir = path.join(buildDir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  // Move every inline <script> body into scripts/inline-script-<n>.js and point
  // the tag at the file via src. The counter advances for every <script> tag in
  // document order; tags with an empty body (already-external scripts) are left
  // untouched but still consume an index.
  const html = await fs.readFile(htmlPath, 'utf8');
  let htmlOut = '';
  let lastIndex = 0;
  let scriptIndex = 0;
  SCRIPT_TAG_REGEX.lastIndex = 0;
  let match;
  while ((match = SCRIPT_TAG_REGEX.exec(html)) !== null) {
    const [fullTag, attrs, scriptContent] = match;
    htmlOut += html.slice(lastIndex, match.index);
    lastIndex = match.index + fullTag.length;
    if (scriptContent) {
      const scriptFileName = `inline-script-${scriptIndex}.js`;
      const scriptPath = path.join(scriptsDir, scriptFileName);
      await fs.writeFile(scriptPath, scriptContent, 'utf8');
      htmlOut += `<script${attrs} src="scripts/${scriptFileName}"></script>`;
    } else {
      htmlOut += fullTag;
    }
    scriptIndex++;
  }
  htmlOut += html.slice(lastIndex);
  await fs.writeFile(htmlPath, htmlOut, 'utf8');
  console.log('Externalized inline scripts.');

  // Update manifest with a strict CSP
  const manifestPath = path.join(buildDir, 'manifest.json');
  if (!(await pathExists(manifestPath))) {
    console.log('manifest.json not found. Skipping CSP update.');
    return;
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.content_security_policy = {
    extension_pages: "script-src 'self'; object-src 'self'",
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log('Updated manifest.json with a strict CSP.');
}

//4. Rename /_next to /next
async function renameNextDir() {
  const oldDir = path.join(buildDir, '_next');
  const newDir = path.join(buildDir, 'next');
  if (await pathExists(oldDir)) {
    await fs.rename(oldDir, newDir);
    console.log('Renamed _next to next');
  }
}

async function main() {
  console.log('Starting post-build script...');
  await copyManifest();
  await fixPaths(buildDir);
  console.log('Fixed asset paths.');
  await externalizeScriptsAndUpdateCsp();
  await renameNextDir();
  console.log('Post-build script finished.');
}

main().catch(console.error);
