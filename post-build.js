const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');

const buildDir = path.join(__dirname, 'build');
const publicDir = path.join(__dirname, 'public');

// 1. Copy manifest.json from public to build
async function copyManifest() {
  const src = path.join(publicDir, 'manifest.json');
  const dest = path.join(buildDir, 'manifest.json');
  await fs.copy(src, dest);
  console.log('Copied manifest.json to build directory.');
}

// 2. Replace /_next/ with ./ in all HTML, CSS, and JS files
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

// 3. Externalize inline scripts and update CSP
async function externalizeScriptsAndUpdateCsp() {
  const htmlPath = path.join(buildDir, 'index.html');
  if (!(await fs.pathExists(htmlPath))) {
    console.log('index.html not found. Skipping script externalization.');
    return;
  }

  const scriptsDir = path.join(buildDir, 'scripts');
  await fs.ensureDir(scriptsDir);

  const $ = cheerio.load(await fs.readFile(htmlPath, 'utf8'));
<<<<<<< HEAD
  $('script').each((i, el) => {
    const scriptContent = $(el).html();
    if (scriptContent) {
      const scriptFileName = `inline-script-${i}.js`;
      const scriptPath = path.join(scriptsDir, scriptFileName);
      fs.writeFileSync(scriptPath, scriptContent, 'utf8');
      $(el).html('').attr('src', `scripts/${scriptFileName}`);
    }
  });

  await fs.writeFile(htmlPath, $.html(), 'utf8');
  console.log('Externalized inline scripts.');

  // Update manifest with a strict CSP
  const manifestPath = path.join(buildDir, 'manifest.json');
   if (!(await fs.pathExists(manifestPath))) {
      console.log('manifest.json not found. Skipping CSP update.');
      return;
  }
  const manifest = await fs.readJson(manifestPath);
  manifest.content_security_policy = {
    "extension_pages": "script-src 'self'; object-src 'self'"
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  console.log("Updated manifest.json with a strict CSP.");
}


// 4. Rename /_next to /next
async function renameNextDir() {
  const oldDir = path.join(buildDir, '_next');
  const newDir = path.join(buildDir, 'next');
  if (await fs.pathExists(oldDir)) {
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