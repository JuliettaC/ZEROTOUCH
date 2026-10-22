const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const baseline = JSON.parse(fs.readFileSync('scripts/data/prototype-baseline.json'));
for (const [file, expected] of Object.entries(baseline.files)) {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, `Preserved file changed: ${file}`);
}
const files = fs.readdirSync('frontend/src', {recursive:true}).filter(f=>/\.(js|jsx|css)$/.test(f));
for (const file of files) {
  const text = fs.readFileSync(`frontend/src/${file}`, 'utf8');
  assert.ok(!/\.\.\/\.\.\/\.\.\/(src|public)|localStorage|better-sqlite3/.test(text), `Boundary violation: ${file}`);
}
const config = fs.readFileSync('frontend/vite.config.js', 'utf8');
assert.ok(config.includes('publicDir: false'));
assert.ok(config.includes("outDir: 'dist'"));
const scripts = JSON.parse(fs.readFileSync('package.json')).scripts;
assert.equal(scripts.build, 'vite build');
assert.equal(scripts['build:app'], 'vite build --config frontend/vite.config.js');
console.log(`${Object.keys(baseline.files).length} preserved files match SHA-256; independent build commands verified.`);
