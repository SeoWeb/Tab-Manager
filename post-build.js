const fs = require('fs');
const path = require('path');

const buildDir = path.join(__dirname, 'build');
const oldDir = path.join(buildDir, '_next');
const newDir = path.join(buildDir, 'next');

if (fs.existsSync(oldDir)) {
  fs.renameSync(oldDir, newDir);
  console.log('Renamed _next to next');
}