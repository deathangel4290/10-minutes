// Turns palette-string art into canvases at startup, plus procedural
// environment art (trees, bushes) and the variants the renderer needs
// (mirrored, white hit-flash, elite palette).

import { PAL, RARITY_SWAP, ENV, BIOME_PALETTES } from './palette.js';
import { ART, ICONS, HELM_OVERLAY } from './art.js';
import { ARMOR_TINTS } from '../data/armor.js';
import { VENDORS } from '../data/town.js';
import { RNG } from '../core/rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Bake string rows into a canvas. `swap` overrides palette entries. */
export function bake(rows, swap = null) {
  const h = rows.length;
  const w = rows[0].length;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      const hex = (swap && swap[ch]) || PAL[ch];
      if (!hex) continue;
      const [r, g, b] = hexToRgb(hex);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function flipH(src) {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** Solid-color silhouette (used for the white hit flash). */
export function silhouette(src, color = '#ffffff') {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Add a 1px outline around opaque pixels. */
export function outline(src, color = PAL['0']) {
  const w = src.width + 2;
  const h = src.height + 2;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const sil = silhouette(src, color);
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) ctx.drawImage(sil, dx, dy);
  ctx.drawImage(src, 1, 1);
  return c;
}

/** Sprite bundle: right-facing, left-facing and flash versions. */
function bundle(canvas) {
  return { r: canvas, l: flipH(canvas), flashR: silhouette(canvas), flashL: silhouette(flipH(canvas)), w: canvas.width, h: canvas.height };
}

// Which art character marks an enemy's eyes, and the glow for slime eyes.
const EYE_CHAR = { slime: '7', slimeling: '7' };
const SLIME_EYE = '#d4ff9a';

function findPixels(rows, ch) {
  const out = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === ch) out.push([x, y]);
  });
  return out;
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** A round light pool in 4 dithered bands (white with alpha, used to cut darkness). */
function makeLightPool(r) {
  const size = r * 2;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const bands = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
      if (d >= 1) continue;
      // Bright core, then a falloff toward the rim.
      const v = d < 0.35 ? 1 : 1 - (d - 0.35) / 0.65;
      const lv = Math.max(0, v) * bands;
      let level = Math.floor(lv);
      if (lv - level > (BAYER4[y & 3][x & 3] + 0.5) / 16) level++;
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round((Math.min(bands, level) / bands) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Blob-shaped splat for decals: a rough disc plus a few droplets. */
function splat(rng, w, h, colors, droplets = 3, rough = 0.7) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 1.5;
  const ry = h / 2 - 1.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d > 1 + rng.range(-rough, rough) * 0.35) continue;
      ctx.fillStyle = d < 0.45 && rng.chance(0.6) ? colors[1] : colors[0];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  for (let i = 0; i < droplets; i++) {
    const a = rng.range(0, Math.PI * 2);
    ctx.fillStyle = colors[0];
    ctx.fillRect(Math.round(cx + Math.cos(a) * (rx + 1)), Math.round(cy + Math.sin(a) * (ry + 1)), 1, 1);
  }
  return c;
}

/** Marks left on the ground: blood, slime, bones, ash, scorch and footprints. */
function makeDecals(rng) {
  const D = {};
  D.blood = Array.from({ length: 4 }, () => splat(rng, rng.int(7, 10), rng.int(5, 7), ['#4a0f18', '#6e1823'], rng.int(2, 4)));
  D.slime = Array.from({ length: 4 }, () => splat(rng, rng.int(8, 11), rng.int(5, 7), ['#2a4a26', '#3f6f34'], rng.int(1, 3)));
  D.ash = Array.from({ length: 4 }, () => splat(rng, rng.int(7, 10), rng.int(5, 7), ['#1c1226', '#33204a'], rng.int(2, 4)));
  D.scorch = Array.from({ length: 4 }, () => {
    const c = splat(rng, rng.int(14, 18), rng.int(9, 12), ['#120e16', '#1c1418'], rng.int(3, 6), 1);
    const ctx = c.getContext('2d');
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = '#5a2410';
      ctx.fillRect(rng.int(4, c.width - 5), rng.int(3, c.height - 4), 1, 1);
    }
    return c;
  });
  D.bones = Array.from({ length: 4 }, () => {
    const c = makeCanvas(12, 8);
    const ctx = c.getContext('2d');
    const bone = '#8f8a78';
    // A small skull...
    const sx = rng.int(1, 7);
    const sy = rng.int(1, 4);
    ctx.fillStyle = '#b9b3a0';
    ctx.fillRect(sx, sy, 3, 2);
    ctx.fillRect(sx + 1, sy + 2, 1, 1);
    ctx.fillStyle = '#2a2433';
    ctx.fillRect(sx, sy + 1, 1, 1);
    ctx.fillRect(sx + 2, sy + 1, 1, 1);
    // ...and a couple of scattered bones.
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = bone;
      const bx = rng.int(0, 8);
      const by = rng.int(0, 7);
      if (rng.chance(0.5)) ctx.fillRect(bx, by, 4, 1);
      else ctx.fillRect(bx + 1, by - 1 < 0 ? 0 : by - 1, 1, 3);
    }
    return c;
  });
  D.step = [0, 1].map((side) => {
    const c = makeCanvas(2, 3);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7f8ea8';
    ctx.fillRect(0, side, 2, 2);
    return c;
  });
  return D;
}

const ELITE_SWAP = {
  w: '#9c86c9', W: '#6a4f9a', R: '#ff9a3c', // skeleton bone -> violet, eyes orange
  l: '#a35fe0', L: '#d7a8ff', G: '#5a2a8a', g: '#2c1145', // slime -> violet
  '5': '#3d3550', '6': '#7d6aa3', '4': '#2a2338', // wolf -> shadow wolf
};

const CHAMPION_SWAP = { w: '#e8dcc0', W: '#b9a27a', R: '#ff5a2a', '1': '#3a0f12' };

const ENEMY_FRAMES = {
  skeleton: ['skeleton_a', 'skeleton_b', 'skeleton_wind'],
  slime: ['slime'],
  slimeling: ['slimeling'],
  wolf: ['wolf_a', 'wolf_b', 'wolf_crouch'],
  archer: ['archer_a', 'archer_b', 'archer_wind'],
  mage: ['mage_a', 'mage_b', 'mage_wind'],
};

// Region skins recolor the same enemies so each region has its own look.
export const ENEMY_SKINS = {
  champion: CHAMPION_SWAP,
  frost: { w: '#cfe3f2', W: '#8fb3cc', R: '#8fd3ff', l: '#8fd3ff', L: '#d6f0ff', G: '#3f6f9a', g: '#1f3f5a', '5': '#c9d6e6', '4': '#8a9cb3', '6': '#eef4fb', p: '#2a3f5f', q: '#4f8de0', Q: '#c4e4f5', N: '#5a6a80' },
  magma: { w: '#5a4844', W: '#3a2c28', R: '#ff6a1a', l: '#e2571c', L: '#ffb347', G: '#8e2a10', g: '#4a1408', '5': '#4a3a3a', '4': '#2e2424', '6': '#6e5858', p: '#3a1010', q: '#c2410c', Q: '#ffd36b', N: '#2e2424' },
  crypt: { w: '#b8c9a8', W: '#7f9270', R: '#7fd65a', l: '#6b8f5a', L: '#a3c78a', G: '#3a5a32', g: '#1f331c', '5': '#6d6588', '4': '#4a4560', '6': '#a49cbd', p: '#1f2a1c', q: '#4f7a3a', Q: '#b6f06a' },
};

// ── Weapon sprites held in hand (pointing right, pivot at the grip) ─────
const WEAPON_ART = {
  sword: { rows: ['...X..........', 'nnNX777777776.', 'nnNX56666660..', '...X..........'], pivot: [1.5, 1.5] },
  dagger: { rows: ['..X......', 'nNX77776.', 'nNX5660..', '..X......'], pivot: [1, 1.5] },
  axe: {
    rows: ['.........00..', '........0560.', '........05660', 'nnNnnNnnX5667', 'nnNnnNnnX5667', '........05660', '........0560.', '.........00..'],
    pivot: [1.5, 3.5],
  },
};

// ── Procedural environment art ─────────────────────────────
const DEFAULT_TREE = { dark: ENV.treeDark, mid: ENV.treeMid, light: ENV.treeLight, hi: ENV.treeHi, moon: ENV.treeMoon, trunk: ENV.trunk, trunkHi: ENV.trunkHi };

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function makePine(rng, C = DEFAULT_TREE, snow = false) {
  const w = 22;
  const h = 34;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2;
  // Trunk
  for (let y = h - 6; y < h; y++) {
    px(ctx, Math.floor(cx) - 1, y, C.trunk);
    px(ctx, Math.floor(cx), y, C.trunkHi);
  }
  // Layers of foliage, widest at the bottom.
  const layers = rng.int(3, 4);
  const top = rng.int(1, 3);
  const bottom = h - 6;
  const layerH = (bottom - top) / layers;
  for (let i = 0; i < layers; i++) {
    const y0 = Math.floor(top + i * layerH * 0.82);
    const y1 = Math.floor(top + (i + 1) * layerH + 2);
    const maxHalf = 4 + (i + 1) * ((w / 2 - 2) / layers) - 1;
    for (let y = y0; y <= y1 && y < h - 4; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0);
      const half = Math.max(1, Math.round(1 + t * maxHalf));
      for (let x = Math.floor(cx - half); x <= Math.floor(cx + half); x++) {
        if (x < 0 || x >= w) continue;
        const rel = (x - (cx - half)) / (half * 2);
        let col = C.mid;
        if (rel < 0.3) col = C.dark;
        else if (rel > 0.72) col = C.light;
        if (t < 0.25 && rel > 0.5) col = C.light;
        if (rel > 0.85 && t < 0.6 && rng.chance(0.5)) col = C.hi;
        // Ragged bottom edge of each layer.
        if (y === y1 && rng.chance(0.4)) continue;
        if (rng.chance(0.06)) col = C.dark;
        px(ctx, x, y, col);
      }
    }
  }
  if (snow) addSnowCaps(c, C);
  else if (rng.chance(0.5)) px(ctx, Math.floor(cx) + 2, top + 6, C.moon);
  return outline(c);
}

/** Paint snow on every upward-facing foliage edge. */
function addSnowCaps(c, C) {
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const data = ctx.getImageData(0, 0, w, h).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h - 6; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y) || solid(x, y - 1)) continue;
      px(ctx, x, y, C.snow);
      if (solid(x, y + 1) && (x + y) % 2 === 0) px(ctx, x, y + 1, C.snowShade);
    }
  }
}

function makeRoundTree(rng, C = DEFAULT_TREE) {
  const w = 24;
  const h = 30;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2;
  for (let y = h - 9; y < h; y++) {
    px(ctx, Math.floor(cx) - 1, y, C.trunk);
    px(ctx, Math.floor(cx), y, C.trunkHi);
    if (y > h - 3) px(ctx, Math.floor(cx) - 2, y, C.trunk);
  }
  const blobs = [];
  for (let i = 0; i < 6; i++) blobs.push([cx + rng.range(-6, 6), rng.range(7, 15), rng.range(4, 7)]);
  for (let y = 0; y < h - 6; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let light = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x - bx, y - by);
        if (d < br) {
          inside = true;
          light = Math.max(light, (bx - x + (by - y)) / br);
        }
      }
      if (!inside) continue;
      let col = C.mid;
      if (light < -0.6) col = C.dark;
      else if (light > 0.55) col = C.hi;
      else if (light > 0.1) col = C.light;
      if (rng.chance(0.05)) col = C.dark;
      px(ctx, x, y, col);
    }
  }
  return outline(c);
}

function makeDeadTree(rng, D = { col: '#2e2633', hi: '#463a4d' }) {
  const w = 22;
  const h = 30;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = Math.floor(w / 2);
  const col = D.col;
  const hi = D.hi;
  for (let y = 8; y < h; y++) {
    px(ctx, cx - 1, y, col);
    px(ctx, cx, y, hi);
    if (y > h - 4) {
      px(ctx, cx - 2, y, col);
      px(ctx, cx + 1, y, col);
    }
  }
  const branch = (x, y, dx, len) => {
    for (let i = 0; i < len; i++) {
      x += dx;
      if (i % 2 === 0) y -= 1;
      if (rng.chance(0.2)) y -= 1;
      px(ctx, Math.round(x), Math.round(y), i < len - 2 ? hi : col);
    }
  };
  branch(cx, 14, -1, rng.int(5, 8));
  branch(cx, 11, 1, rng.int(5, 8));
  branch(cx, 18, 1, rng.int(3, 6));
  branch(cx, 9, -0.6, rng.int(4, 6));
  for (let y = 4; y < 9; y++) px(ctx, cx, y, hi);
  if (D.ember) {
    // Glowing cracks in the charred wood.
    for (let k = 0; k < 7; k++) px(ctx, cx - 1 + rng.int(0, 1), rng.int(10, h - 2), rng.chance(0.5) ? D.ember : '#ffb347');
  }
  return outline(c);
}

function makeBush(rng) {
  const w = 14;
  const h = 10;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const blobs = [];
  for (let i = 0; i < 4; i++) blobs.push([rng.range(4, 10), rng.range(5, 7), rng.range(2.5, 4)]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let light = 0;
      for (const [bx, by, br] of blobs) {
        const d = Math.hypot(x - bx, y - by);
        if (d < br) {
          inside = true;
          light = Math.max(light, (bx - x + (by - y)) / br);
        }
      }
      if (!inside) continue;
      let col = ENV.treeMid;
      if (light > 0.5) col = ENV.treeLight;
      else if (light < -0.4) col = ENV.treeDark;
      px(ctx, x, y, col);
    }
  }
  if (rng.chance(0.5)) px(ctx, rng.int(4, 9), rng.int(3, 5), rng.chance(0.5) ? ENV.flowerA : ENV.flowerB);
  return outline(c);
}

/** A timber-framed house with a colored roof, lit windows and a shop sign. */
function makeHouse(rng, vendor, iconCanvas) {
  const w = 80;
  const h = 84;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const [roofDark, roofMid, roofHi] = vendor.roof;
  const wallTop = 36;
  // Walls: plaster between dark timber beams, stone footing.
  ctx.fillStyle = '#3a3350';
  ctx.fillRect(4, wallTop, w - 8, h - wallTop);
  ctx.fillStyle = '#2f2a42';
  for (let i = 0; i < 70; i++) ctx.fillRect(4 + rng.int(0, w - 9), wallTop + rng.int(0, h - wallTop - 8), 1, 1);
  ctx.fillStyle = '#241e33';
  for (const bx of [4, 22, w - 25, w - 7]) ctx.fillRect(bx, wallTop, 3, h - wallTop);
  ctx.fillRect(4, wallTop + 18, w - 8, 3);
  ctx.fillStyle = '#2a2838';
  ctx.fillRect(2, h - 7, w - 4, 7);
  ctx.fillStyle = '#3b3850';
  for (let x = 4; x < w - 4; x += 6) ctx.fillRect(x, h - 6, 4, 2);
  // Door with a warm glow.
  const dx = w / 2 - 8;
  ctx.fillStyle = '#ffb347';
  ctx.fillRect(dx - 1, h - 31, 18, 25);
  ctx.fillStyle = '#3b2618';
  ctx.fillRect(dx, h - 30, 16, 24);
  ctx.fillStyle = '#6e4a2c';
  for (let y = h - 28; y < h - 7; y += 4) ctx.fillRect(dx + 2, y, 12, 1);
  ctx.fillStyle = '#ffd36b';
  ctx.fillRect(dx + 12, h - 19, 2, 2);
  // Windows.
  for (const wx of [8, w - 22]) {
    ctx.fillStyle = '#241e33';
    ctx.fillRect(wx - 1, wallTop + 4, 14, 12);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(wx, wallTop + 5, 12, 10);
    ctx.fillStyle = '#ffd36b';
    ctx.fillRect(wx + 1, wallTop + 6, 4, 3);
    ctx.fillStyle = '#241e33';
    ctx.fillRect(wx + 5, wallTop + 5, 2, 10);
    ctx.fillRect(wx, wallTop + 9, 12, 2);
  }
  // Roof: layered shingles with an overhang.
  for (let y = 0; y < wallTop + 6; y++) {
    const t = y / (wallTop + 6);
    const half = Math.round(12 + t * (w / 2 - 10));
    const row = Math.floor(y / 4);
    ctx.fillStyle = y < 3 ? roofHi : row % 2 ? roofMid : roofDark;
    ctx.fillRect(w / 2 - half, y, half * 2, 1);
    if (y % 4 === 3) {
      ctx.fillStyle = '#07060c';
      for (let x = w / 2 - half + (row % 2 ? 3 : 0); x < w / 2 + half; x += 7) ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.fillStyle = roofHi;
  ctx.fillRect(w / 2 - 12, 0, 24, 2);
  // Chimney.
  ctx.fillStyle = '#2a2838';
  ctx.fillRect(w - 24, 2, 7, 12);
  ctx.fillStyle = '#3b3850';
  ctx.fillRect(w - 25, 1, 9, 3);
  // Hanging sign with the shop's icon.
  const sx = dx + 19;
  const sy = wallTop + 22;
  ctx.fillStyle = '#241e33';
  ctx.fillRect(sx + 7, sy - 4, 1, 4);
  ctx.fillStyle = '#6e4a2c';
  ctx.fillRect(sx, sy, 16, 15);
  ctx.fillStyle = '#3b2618';
  ctx.fillRect(sx + 1, sy + 1, 14, 13);
  ctx.drawImage(iconCanvas, sx + 8 - Math.floor(iconCanvas.width / 2), sy + 8 - Math.floor(iconCanvas.height / 2));
  return outline(c);
}

function makeNoticeBoard() {
  const c = makeCanvas(18, 20);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3b2618';
  ctx.fillRect(2, 8, 2, 12);
  ctx.fillRect(14, 8, 2, 12);
  ctx.fillStyle = '#6e4a2c';
  ctx.fillRect(0, 0, 18, 12);
  ctx.fillStyle = '#a5784a';
  ctx.fillRect(1, 1, 16, 10);
  ctx.fillStyle = '#e6dcc4';
  ctx.fillRect(3, 2, 5, 6);
  ctx.fillRect(10, 3, 5, 5);
  ctx.fillStyle = '#8e1f2c';
  ctx.fillRect(5, 2, 1, 1);
  ctx.fillRect(12, 3, 1, 1);
  return outline(c);
}

// ── Icons for the DOM UI ───────────────────────────────────
const iconCache = new Map();

/** Returns a data URL for an icon, scaled up crisply. */
export function iconURL(name, rarity = 'common', scale = 4) {
  const key = `${name}|${rarity}|${scale}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const rows = ICONS[name] || ICONS.star;
  const base = bake(rows, RARITY_SWAP[rarity]);
  const c = makeCanvas(base.width * scale, base.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, c.width, c.height);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

/** Data URL of any canvas scaled up crisply (not cached). */
export function canvasURL(src, scale = 6) {
  const c = makeCanvas(src.width * scale, src.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}

/** Data URL for any ART sprite (used by the UI for big pictures). */
export function artURL(name, scale = 4, swap = null) {
  const key = `art|${name}|${scale}|${swap ? JSON.stringify(swap) : ''}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const base = bake(ART[name], swap);
  const c = makeCanvas(base.width * scale, base.height * scale);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, c.width, c.height);
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

// ── Build everything once ──────────────────────────────────
export function buildSprites() {
  const S = {};
  for (const name of ['player_idle', 'player_runA', 'player_runB']) S[name] = bundle(bake(ART[name]));

  // Player frames depend on worn armor: chest and boots tint by rarity, a helm sits on the head.
  const playerCache = new Map();
  S.playerSprites = (gear) => {
    const h = gear && gear.helm ? gear.helm.rarity : '';
    const c = gear && gear.chest ? gear.chest.rarity : '';
    const b = gear && gear.boots ? gear.boots.rarity : '';
    const key = `${h}|${c}|${b}`;
    let set = playerCache.get(key);
    if (set) return set;
    set = {};
    for (const name of ['player_idle', 'player_runA', 'player_runB']) {
      const rows = ART[name].map((row, y) => {
        if (c && y >= 8 && y <= 12) row = row.replace(/3/g, 'A').replace(/4/g, 'B');
        if (b && y >= 13) row = row.replace(/1/g, 'C').replace(/2/g, 'D');
        if (h && y < HELM_OVERLAY.length) {
          const over = HELM_OVERLAY[y];
          row = row.split('').map((ch, x) => (over[x] !== '.' ? over[x] : ch)).join('');
        }
        return row;
      });
      const swap = {};
      if (c) [swap.A, swap.B] = ARMOR_TINTS[c];
      if (b) [swap.C, swap.D] = ARMOR_TINTS[b];
      if (h) [swap.E, swap.F] = ARMOR_TINTS[h];
      set[name] = bundle(bake(rows, swap));
    }
    playerCache.set(key, set);
    return set;
  };

  // Enemy frames are baked lazily per (sprite, skin, elite) combination.
  // Each frame also knows where its eyes are, so they can glow in the dark,
  // and elites/champions get a colored outline so they read at a glance.
  const enemyCache = new Map();
  S.enemyFrames = (sprite, skin = null, elite = false) => {
    const key = `${sprite}|${skin}|${elite}`;
    let frames = enemyCache.get(key);
    if (frames) return frames;
    const names = ENEMY_FRAMES[sprite] || ENEMY_FRAMES.skeleton;
    let swap = skin ? ENEMY_SKINS[skin] : null;
    if (elite) swap = { ...(swap || {}), ...ELITE_SWAP };
    const eyeChar = EYE_CHAR[sprite] || 'R';
    const eyeColor = eyeChar === 'R' ? (swap && swap.R) || PAL.R : SLIME_EYE;
    frames = names.map((n) => ({ ...bundle(bake(ART[n], swap)), eyes: findPixels(ART[n], eyeChar) }));
    frames.eyeColor = eyeColor;
    const outlineColor = skin === 'champion' ? '#ff4a3a' : elite ? '#ffab40' : null;
    if (outlineColor) for (const f of frames) [f.outR, f.outL] = [outline(f.r, outlineColor), outline(f.l, outlineColor)];
    enemyCache.set(key, frames);
    return frames;
  };

  S.chest = {};
  S.chestOpen = {};
  for (const r of Object.keys(RARITY_SWAP)) {
    S.chest[r] = bake(ART.chest, RARITY_SWAP[r]);
    S.chestOpen[r] = bake(ART.chest_open, RARITY_SWAP[r]);
  }
  const mysterySwap = { m: '#3a2350', N: '#24163a', n: '#15102a', X: '#7a3fc0', Y: '#d7a8ff' };
  S.chestMystery = bake(ART.chest, mysterySwap);
  S.chestMysteryOpen = bake(ART.chest_open, mysterySwap);

  S.coin = [bake(ART.coin_a), bake(ART.coin_b)];
  S.shard = bake(ART.shard);
  S.shardBig = bake(ART.shard_big);
  S.potion = bake(ART.potion);
  S.shrine = {
    blood: bake(ART.shrine, { X: '#e0384a', Y: '#8e1f2c' }),
    greed: bake(ART.shrine, { X: '#ffd36b', Y: '#c2561f' }),
    fortune: bake(ART.shrine, { X: '#b68cff', Y: '#4a2370' }),
    haste: bake(ART.shrine, { X: '#8fd3ff', Y: '#1f3f7a' }),
    spent: bake(ART.shrine, { X: '#3a3350', Y: '#241e33' }),
  };
  S.merchant = bundle(bake(ART.merchant));
  S.npc = {};
  for (const v of VENDORS) S.npc[v.id] = bundle(bake(ART.merchant, v.npc));
  S.buildings = {};
  const hrng = new RNG(99);
  for (const v of VENDORS) S.buildings[`house_${v.id}`] = makeHouse(hrng, v, bake(ICONS[v.sign], RARITY_SWAP.legendary));
  S.noticeBoard = makeNoticeBoard();
  S.grave = bake(ART.grave);
  S.rock = bake(ART.rock);
  S.bones = bake(ART.bones);
  S.pillar = bake(ART.pillar);
  S.pillarBroken = bake(ART.pillar_broken);
  S.torch = bake(ART.torch);
  S.brazier = bake(ART.brazier);
  S.brazierOut = bake(ART.brazier_out);

  S.weapons = {};
  for (const [id, def] of Object.entries(WEAPON_ART)) {
    S.weapons[id] = {};
    for (const r of Object.keys(RARITY_SWAP)) {
      S.weapons[id][r] = { img: bake(def.rows, RARITY_SWAP[r]), pivot: def.pivot };
    }
  }
  S.weaponIcons = {};
  S.relicIcons = {};
  for (const r of Object.keys(RARITY_SWAP)) {
    for (const name of ['sword', 'dagger', 'axe']) S.weaponIcons[`${name}|${r}`] = bake(ICONS[name], RARITY_SWAP[r]);
  }
  S.icon = (name, rarity = 'common') => {
    const key = `${name}|${rarity}`;
    if (!S.relicIcons[key]) S.relicIcons[key] = bake(ICONS[name] || ICONS.star, RARITY_SWAP[rarity]);
    return S.relicIcons[key];
  };

  // Procedural environment variants (seeded so they are identical every boot).
  const rng = new RNG(1337);
  const snowP = BIOME_PALETTES.snow;
  const ashP = BIOME_PALETTES.ash;
  S.props = {
    pine: Array.from({ length: 5 }, () => makePine(rng)),
    round: Array.from({ length: 4 }, () => makeRoundTree(rng)),
    dead: Array.from({ length: 3 }, () => makeDeadTree(rng)),
    snowpine: Array.from({ length: 5 }, () => makePine(rng, snowP.tree, true)),
    ashtree: Array.from({ length: 4 }, () => makeDeadTree(rng, ashP.dead)),
  };
  S.bushes = Array.from({ length: 4 }, () => makeBush(rng));

  // Light pools for the lighting pass, drawn the pixel-art way: a few flat
  // bands with ordered dithering between them instead of a smooth blur.
  // Baked per (even) radius at 1:1 so the dither stays crisp.
  const lightCache = new Map();
  S.lightAt = (radius) => {
    const r = Math.max(4, Math.round(radius / 2) * 2);
    let c = lightCache.get(r);
    if (!c) {
      c = makeLightPool(r);
      lightCache.set(r, c);
    }
    return c;
  };
  S.decals = makeDecals(new RNG(4040));

  S.glow = {};
  for (const [name, color] of Object.entries({ purple: '182,140,255', orange: '255,154,60', red: '224,56,74', blue: '90,166,255', green: '127,214,90', white: '244,242,255', gold: '255,211,107' })) {
    const g = makeCanvas(32, 32);
    const gctx = g.getContext('2d');
    const gg = gctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gg.addColorStop(0, `rgba(${color},0.9)`);
    gg.addColorStop(0.4, `rgba(${color},0.35)`);
    gg.addColorStop(1, `rgba(${color},0)`);
    gctx.fillStyle = gg;
    gctx.fillRect(0, 0, 32, 32);
    S.glow[name] = g;
  }
  return S;
}
