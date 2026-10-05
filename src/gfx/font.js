// Tiny 3x5 bitmap font for in-world text (damage numbers, labels).
// Glyphs are baked per color with a 1px dark outline so they read on any background.

import { makeCanvas } from './sprites.js';

const G = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'], '-': ['...', '...', '###', '...', '...'], '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'], ' ': ['...', '...', '...', '...', '...'], ':': ['...', '.#.', '...', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'], '%': ['#.#', '..#', '.#.', '#..', '#.#'], x: ['...', '#.#', '.#.', '#.#', '...'],
};

const CHARS = Object.keys(G);
const CELL_W = 5; // 3px glyph + outline
const CELL_H = 7;
const atlases = new Map();

function atlas(color) {
  let a = atlases.get(color);
  if (a) return a;
  const c = makeCanvas(CHARS.length * CELL_W, CELL_H);
  const ctx = c.getContext('2d');
  const index = {};
  CHARS.forEach((ch, i) => {
    index[ch] = i;
    const rows = G[ch];
    const ox = i * CELL_W + 1;
    ctx.fillStyle = '#07060c';
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 3; x++)
        if (rows[y][x] === '#')
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) ctx.fillRect(ox + x + dx, 1 + y + dy, 1, 1);
    ctx.fillStyle = color;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (rows[y][x] === '#') ctx.fillRect(ox + x, 1 + y, 1, 1);
  });
  a = { canvas: c, index };
  atlases.set(color, a);
  return a;
}

export function textWidth(text, scale = 1) {
  return (text.length * 4 - 1) * scale;
}

/** Draw text with its top-left (align 'left') or top-center (align 'center') at x,y. */
export function drawText(ctx, text, x, y, color = '#f4f2ff', scale = 1, align = 'center') {
  const a = atlas(color);
  const str = String(text).toUpperCase();
  let cx = Math.round(align === 'center' ? x - textWidth(str, scale) / 2 : x);
  const cy = Math.round(y);
  for (const ch of str) {
    const i = a.index[ch] ?? a.index[ch.toLowerCase()] ?? a.index[' '];
    ctx.drawImage(a.canvas, i * CELL_W, 0, CELL_W, CELL_H, cx - scale, cy - scale, CELL_W * scale, CELL_H * scale);
    cx += 4 * scale;
  }
}
