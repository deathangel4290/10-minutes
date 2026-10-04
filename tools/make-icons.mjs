// Generates the PWA icons (pixel-art eclipse + "10") as PNGs with no dependencies.
// Usage: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// 32x32 design, upscaled.
const G = 32;
const DIGITS = {
  1: ['.##', '###', '.##', '.##', '.##', '.##', '###'],
  0: ['####', '#..#', '#..#', '#..#', '#..#', '#..#', '####'],
};
function design(x, y) {
  const cx = 16, cy = 13;
  const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  // background gradient (dithered)
  const t = y / G;
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]][y % 4][x % 4] / 16;
  let col = t + bayer * 0.25 > 0.7 ? [58, 22, 70] : t + bayer * 0.25 > 0.4 ? [30, 14, 48] : [12, 8, 22];
  if (d < 12 && d >= 9.5) col = [182, 140, 255];
  if (d < 13.2 && d >= 12) col = [122, 63, 192];
  if (d < 9.5) col = [5, 3, 10];
  // "10" in the eclipse
  const dx = x - 10, dy = y - 10;
  if (dy >= 0 && dy < 7) {
    const one = DIGITS[1][dy];
    const zero = DIGITS[0][dy];
    if (dx >= 0 && dx < 3 && one[dx] === '#') col = [244, 242, 255];
    if (dx >= 5 && dx < 9 && zero[dx - 5] === '#') col = [244, 242, 255];
  }
  // ground + embers
  if (y >= 27) col = [7, 6, 12];
  if (y === 27 && x % 5 === 2) col = [255, 154, 60];
  return col;
}
mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  const s = size / G;
  writeFileSync(`icons/icon-${size}.png`, png(size, (x, y) => design(Math.floor(x / s), Math.floor(y / s))));
}
console.log('icons written');
