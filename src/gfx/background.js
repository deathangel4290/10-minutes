// Bakes the static ground layer of a map (tiles, walls, decor, prop shadows)
// into one canvas, so each frame draws the ground with a single drawImage.
// Colors come from the region's palette.

import { TILE } from '../data/config.js';
import { T } from '../game/map.js';
import { BIOME_PALETTES } from './palette.js';
import { makeCanvas } from './sprites.js';
import { RNG } from '../core/rng.js';

export function bakeBackground(map, S) {
  const size = map.size;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rng = new RNG(map.seed ^ 0x1234567);
  const N = map.n;
  const P = BIOME_PALETTES[map.biome.palette] || BIOME_PALETTES.forest;

  const fill = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const speckle = (x0, y0, colors, count) => {
    for (let i = 0; i < count; i++) fill(x0 + rng.int(0, 15), y0 + rng.int(0, 15), 1, 1, rng.pick(colors));
  };
  const openNear = (tx, ty) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!map.isSolid(tx + dx, ty + dy) || map.tile(tx + dx, ty + dy) === T.PILLAR) return true;
    return false;
  };

  // Ground tiles.
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      const t = map.tile(tx, ty);
      const x = tx * TILE;
      const y = ty * TILE;
      switch (t) {
        case T.GRASS:
        case T.TREE:
          fill(x, y, TILE, TILE, rng.pick(P.ground));
          speckle(x, y, P.groundHi, 9);
          speckle(x, y, P.groundLo, 6);
          break;
        case T.DARK:
          fill(x, y, TILE, TILE, P.dark);
          speckle(x, y, P.darkHi, 8);
          speckle(x, y, P.darkLo, 8);
          break;
        case T.BORDER:
          fill(x, y, TILE, TILE, P.border);
          speckle(x, y, P.groundLo, 6);
          break;
        case T.DIRT:
          fill(x, y, TILE, TILE, rng.pick(P.dirt));
          speckle(x, y, P.dirtHi, 7);
          speckle(x, y, P.dirtLo, 6);
          break;
        case T.ICE:
          fill(x, y, TILE, TILE, rng.pick(P.pool));
          speckle(x, y, P.poolHi, 4);
          if (rng.chance(0.35)) fill(x + rng.int(1, 9), y + rng.int(2, 13), rng.int(3, 6), 1, P.poolHi[0]); // glint
          break;
        case T.LAVA:
          fill(x, y, TILE, TILE, rng.pick(P.pool));
          speckle(x, y, P.poolHi, 10);
          break;
        case T.COBBLE:
          drawCobble(ctx, rng, x, y, P);
          break;
        case T.STONE:
        case T.PILLAR:
        case T.WALL:
          drawStoneFloor(ctx, rng, x, y, P);
          break;
      }
    }
  }

  // Shorelines: pools get a darker rim where they meet land.
  for (let ty = 1; ty < N - 1; ty++) {
    for (let tx = 1; tx < N - 1; tx++) {
      const t = map.tile(tx, ty);
      if (t !== T.ICE && t !== T.LAVA) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = map.tile(tx + dx, ty + dy);
        if (nt === t) continue;
        const rim = t === T.LAVA ? '#7a1f08' : '#8fb8d4';
        for (let i = 0; i < 16; i++) {
          const px = dx === 0 ? tx * TILE + i : dx > 0 ? (tx + 1) * TILE - 1 : tx * TILE;
          const py = dy === 0 ? ty * TILE + i : dy > 0 ? (ty + 1) * TILE - 1 : ty * TILE;
          if (rng.chance(0.85)) fill(px, py, 1, 1, rim);
        }
      }
    }
  }

  // Soften dirt path edges into the ground.
  for (let ty = 1; ty < N - 1; ty++) {
    for (let tx = 1; tx < N - 1; tx++) {
      if (map.tile(tx, ty) !== T.DIRT) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = map.tile(tx + dx, ty + dy);
        if (nt !== T.GRASS && nt !== T.DARK && nt !== T.TREE) continue;
        for (let i = 0; i < 10; i++) {
          const along = rng.int(0, 15);
          const depth = rng.int(0, 2) + (rng.chance(0.3) ? 1 : 0);
          const px = dx === 0 ? tx * TILE + along : dx > 0 ? (tx + 1) * TILE + depth : tx * TILE - 1 - depth;
          const py = dy === 0 ? ty * TILE + along : dy > 0 ? (ty + 1) * TILE + depth : ty * TILE - 1 - depth;
          fill(px, py, 1, 1, rng.pick(P.dirt));
        }
      }
    }
  }

  // Walls: a lighter top face with a darker front face. Deep wall mass (in the
  // crypt) is drawn as plain dark rock so corridors read clearly.
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      if (map.tile(tx, ty) !== T.WALL) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      if (!openNear(tx, ty)) {
        fill(x, y, TILE, TILE, P.border);
        speckle(x, y, P.darkLo, 4);
        continue;
      }
      const below = map.tile(tx, ty + 1) === T.WALL;
      fill(x, y - 4, TILE, 13, rng.pick(P.wallTop));
      for (let by = y - 4; by < y + 9; by += 4) {
        fill(x, by, TILE, 1, P.wallLine);
        const off = ((by - y) / 4) % 2 === 0 ? 0 : 5;
        for (let bx = x + off; bx < x + TILE; bx += 8) fill(bx, by, 1, 4, P.wallLine);
      }
      if (!below) {
        fill(x, y + 9, TILE, 6, rng.pick(P.wallFace));
        fill(x, y + 15, TILE, 1, '#07060c');
        for (let i = 0; i < 4; i++) fill(x + rng.int(0, 15), y + 10 + rng.int(0, 4), 1, 1, P.stoneLine);
      }
      if (map.tile(tx, ty - 1) !== T.WALL) fill(x, y - 5, TILE, 1, '#07060c');
      if (map.tile(tx - 1, ty) !== T.WALL) fill(x - 1, y - 4, 1, 20, '#07060c');
      if (map.tile(tx + 1, ty) !== T.WALL) fill(x + TILE, y - 4, 1, 20, '#07060c');
      if (rng.chance(0.25)) fill(x + rng.int(2, 13), y - 4, rng.int(1, 3), 1, P.darkHi[0]); // moss / frost / soot
    }
  }

  // Shadows under props (trees, pillars).
  ctx.fillStyle = P.shadow;
  for (const p of map.props) {
    const w = p.kind === 'pillar' || p.kind === 'pillarBroken' ? 8 : p.kind === 'dead' || p.kind === 'ashtree' ? 9 : 14;
    if (p.kind === 'house' || p.kind === 'stall') continue;
    ellipse(ctx, p.x, p.y, w, 3);
  }

  // Decor.
  for (const d of map.decor) {
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    switch (d.kind) {
      case 'tuft':
      case 'snowtuft':
      case 'ashtuft':
        fill(x, y, 1, 2, P.tuft[0]);
        fill(x + 1, y - 1, 1, 3, P.tuft[1]);
        fill(x + 2, y + 1, 1, 1, P.tuft[0]);
        break;
      case 'flower': {
        fill(x, y + 1, 1, 2, P.tuft[0]);
        fill(x, y, 1, 1, P.flowers[d.v % P.flowers.length]);
        break;
      }
      case 'bush':
        ctx.drawImage(S.bushes[d.v % S.bushes.length], x - 7, y - 8);
        break;
      case 'rock':
        ctx.drawImage(S.rock, x - 5, y - 6);
        break;
      case 'mushroom':
        fill(x, y, 3, 1, '#c2561f');
        fill(x + 1, y + 1, 1, 2, '#c9c6dc');
        fill(x + 1, y, 1, 1, '#ffd36b');
        break;
      case 'crystal':
        fill(x, y - 3, 1, 4, '#8fd3ff');
        fill(x + 1, y - 1, 1, 2, '#c4e4f5');
        fill(x - 1, y - 1, 1, 2, '#5f8fb3');
        break;
      case 'crack':
        for (let i = 0; i < 5; i++) fill(x + i, y + (i % 2), 1, 1, i % 2 ? '#ff6a1a' : '#c2410c');
        break;
      case 'rubble':
        fill(x, y, 2, 1, P.stoneHi[0]);
        fill(x + 3, y + 1, 1, 1, P.stoneHi[1] || P.stoneHi[0]);
        fill(x + 1, y + 2, 2, 1, P.stoneLine);
        break;
      case 'skull':
        fill(x, y, 3, 2, '#d9d2bf');
        fill(x, y + 1, 1, 1, '#07060c');
        fill(x + 2, y + 1, 1, 1, '#07060c');
        fill(x + 1, y + 2, 1, 1, '#a59f8a');
        break;
      case 'candle':
        fill(x, y, 1, 3, '#d9d2bf');
        fill(x, y - 1, 1, 1, '#ffd36b');
        break;
      case 'grave':
        ctx.drawImage(S.grave, x - 4, y - 10);
        break;
      case 'bones':
        ctx.drawImage(S.bones, x - 5, y - 4);
        break;
    }
  }

  // Cursed ground stain.
  for (const z of map.cursedZones) {
    const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
    g.addColorStop(0, 'rgba(90, 30, 140, 0.45)');
    g.addColorStop(0.7, 'rgba(60, 20, 100, 0.25)');
    g.addColorStop(1, 'rgba(40, 10, 70, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(z.x - z.r, z.y - z.r, z.r * 2, z.r * 2);
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, z.r * 0.8);
      fill(Math.round(z.x + Math.cos(a) * r), Math.round(z.y + Math.sin(a) * r), 1, 1, rng.chance(0.5) ? '#7a3fc0' : '#4a2370');
    }
  }
  return c;
}

function drawStoneFloor(ctx, rng, x, y, P) {
  ctx.fillStyle = rng.pick(P.stone);
  ctx.fillRect(x, y, TILE, TILE);
  if (P.flagstones) {
    // Big, quiet flagstones so dungeon floors read clearly against the walls.
    ctx.fillStyle = P.stoneLine;
    ctx.fillRect(x, y + 15, TILE, 1);
    ctx.fillRect(x + 15, y, 1, TILE);
    ctx.fillStyle = rng.pick(P.stoneHi);
    for (let i = 0; i < 3; i++) ctx.fillRect(x + rng.int(1, 14), y + rng.int(1, 14), 1, 1);
    return;
  }
  ctx.fillStyle = P.stoneLine;
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x, y + 15, TILE, 1);
  const o = rng.chance(0.5) ? 4 : 10;
  ctx.fillRect(x + o, y, 1, 7);
  ctx.fillRect(x + ((o + 6) % 16), y + 8, 1, 7);
  ctx.fillStyle = rng.pick(P.stoneHi);
  for (let i = 0; i < 5; i++) ctx.fillRect(x + rng.int(0, 15), y + rng.int(0, 15), 1, 1);
  if (rng.chance(0.3)) {
    ctx.fillStyle = P.darkHi[0];
    ctx.fillRect(x + rng.int(0, 13), y + rng.int(0, 14), rng.int(1, 3), 1);
  }
}

function drawCobble(ctx, rng, x, y, P) {
  ctx.fillStyle = P.stoneLine;
  ctx.fillRect(x, y, TILE, TILE);
  for (let cy = 0; cy < 16; cy += 4) {
    const off = (cy / 4) % 2 ? 2 : 0;
    for (let cx = -off; cx < 16; cx += 5) {
      ctx.fillStyle = rng.pick(P.stone);
      ctx.fillRect(x + Math.max(0, cx), y + cy, Math.min(4, 16 - Math.max(0, cx)), 3);
      if (rng.chance(0.3)) {
        ctx.fillStyle = rng.pick(P.stoneHi);
        ctx.fillRect(x + Math.max(0, cx), y + cy, 1, 1);
      }
    }
  }
}

export function ellipse(ctx, cx, cy, w, h) {
  for (let yy = -h; yy <= h; yy++) {
    const half = Math.round(w * Math.sqrt(Math.max(0, 1 - (yy * yy) / (h * h + 0.01))));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + yy), half * 2, 1);
  }
}
