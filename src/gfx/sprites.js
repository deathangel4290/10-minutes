// Turns palette-string art into canvases at startup, plus procedural
// environment art (trees, bushes) and the variants the renderer needs
// (mirrored, white hit-flash, elite palette).

import { PAL, RARITY_SWAP, ENV } from './palette.js';
import { ART, ICONS } from './art.js';
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

const ELITE_SWAP = {
  w: '#9c86c9', W: '#6a4f9a', R: '#ff9a3c', // skeleton bone -> violet, eyes orange
  l: '#a35fe0', L: '#d7a8ff', G: '#5a2a8a', g: '#2c1145', // slime -> violet
  '5': '#3d3550', '6': '#7d6aa3', '4': '#2a2338', // wolf -> shadow wolf
};

const CHAMPION_SWAP = { w: '#e8dcc0', W: '#b9a27a', R: '#ff5a2a', '1': '#3a0f12' };

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
function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function makePine(rng) {
  const w = 22;
  const h = 34;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2;
  // Trunk
  for (let y = h - 6; y < h; y++) {
    px(ctx, Math.floor(cx) - 1, y, ENV.trunk);
    px(ctx, Math.floor(cx), y, ENV.trunkHi);
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
        let col = ENV.treeMid;
        if (rel < 0.3) col = ENV.treeDark;
        else if (rel > 0.72) col = ENV.treeLight;
        if (t < 0.25 && rel > 0.5) col = ENV.treeLight;
        if (rel > 0.85 && t < 0.6 && rng.chance(0.5)) col = ENV.treeHi;
        // Ragged bottom edge of each layer.
        if (y === y1 && rng.chance(0.4)) continue;
        if (rng.chance(0.06)) col = ENV.treeDark;
        px(ctx, x, y, col);
      }
    }
  }
  if (rng.chance(0.5)) px(ctx, Math.floor(cx) + 2, top + 6, ENV.treeMoon);
  return outline(c);
}

function makeRoundTree(rng) {
  const w = 24;
  const h = 30;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2;
  for (let y = h - 9; y < h; y++) {
    px(ctx, Math.floor(cx) - 1, y, ENV.trunk);
    px(ctx, Math.floor(cx), y, ENV.trunkHi);
    if (y > h - 3) px(ctx, Math.floor(cx) - 2, y, ENV.trunk);
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
      let col = ENV.treeMid;
      if (light < -0.6) col = ENV.treeDark;
      else if (light > 0.55) col = ENV.treeHi;
      else if (light > 0.1) col = ENV.treeLight;
      if (rng.chance(0.05)) col = ENV.treeDark;
      px(ctx, x, y, col);
    }
  }
  return outline(c);
}

function makeDeadTree(rng) {
  const w = 22;
  const h = 30;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const cx = Math.floor(w / 2);
  const col = '#2e2633';
  const hi = '#463a4d';
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

  S.skeleton = ['skeleton_a', 'skeleton_b', 'skeleton_wind'].map((n) => bundle(bake(ART[n])));
  S.skeletonElite = ['skeleton_a', 'skeleton_b', 'skeleton_wind'].map((n) => bundle(bake(ART[n], ELITE_SWAP)));
  S.champion = ['skeleton_a', 'skeleton_b', 'skeleton_wind'].map((n) => bundle(bake(ART[n], CHAMPION_SWAP)));
  S.slime = [bundle(bake(ART.slime))];
  S.slimeElite = [bundle(bake(ART.slime, ELITE_SWAP))];
  S.slimeling = [bundle(bake(ART.slimeling))];
  S.slimelingElite = [bundle(bake(ART.slimeling, ELITE_SWAP))];
  S.wolf = ['wolf_a', 'wolf_b', 'wolf_crouch'].map((n) => bundle(bake(ART[n])));
  S.wolfElite = ['wolf_a', 'wolf_b', 'wolf_crouch'].map((n) => bundle(bake(ART[n], ELITE_SWAP)));

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
  S.grave = bake(ART.grave);
  S.rock = bake(ART.rock);
  S.bones = bake(ART.bones);
  S.pillar = bake(ART.pillar);
  S.pillarBroken = bake(ART.pillar_broken);
  S.torch = bake(ART.torch);

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
  S.pines = Array.from({ length: 5 }, () => makePine(rng));
  S.roundTrees = Array.from({ length: 4 }, () => makeRoundTree(rng));
  S.deadTrees = Array.from({ length: 3 }, () => makeDeadTree(rng));
  S.bushes = Array.from({ length: 4 }, () => makeBush(rng));

  // Soft light texture used by the lighting pass.
  const L = makeCanvas(64, 64);
  const lctx = L.getContext('2d');
  const grad = lctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  lctx.fillStyle = grad;
  lctx.fillRect(0, 0, 64, 64);
  S.light = L;

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
