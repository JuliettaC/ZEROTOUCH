// Rasterize the unchanged Hito 1 hand inside its original 40x40 brand tile.
// Build-time only: npm install --no-save sharp in a separate tooling directory,
// then supply its node_modules path via NODE_PATH. No app runtime dependency.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../public/assets/home-imgImg2.svg'), 'utf8');
  const inner = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>'));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#343942"/><g transform="translate(7.5 10)">${inner}</g></svg>`;
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    const png = await sharp(Buffer.from(svg), { density: 768 }).resize(size, size).png().toBuffer();
    fs.writeFileSync(path.join(__dirname, 'icons', `hand-${size}.png`), png);
    images.push(png);
  }
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const at = 6 + 16 * i;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(path.join(__dirname, 'icons/icon.ico'), Buffer.concat([header, ...images]));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
