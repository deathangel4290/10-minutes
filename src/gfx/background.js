// Bakes the static ground layer of a map (tiles, walls, decor, prop shadows)
// into one canvas, so each frame draws the ground with a single drawImage.

import { TILE } from '../data/config.js';
import { T } from '../game/map.js';
import { ENV } from './palette.js';
import { makeCanvas } from './sprites.js';
import { RNG } from '../core/rng.js';

export function bakeBackground(map, S) {
  const size = map.size;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rng = new RNG(map.seed ^ 0x1234567);
  const N = map.n;

  const fill = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const speckle = (x0, y0, colors, count) => {
    for (let i = 0; i < count; i++) fill(x0 + rng.int(0, 15), y0 + rng.int(0, 15), 1, 1, rng.pick(colors));
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
          fill(x, y, TILE, TILE, rng.pick(ENV.grass));
          speckle(x, y, ENV.grassHi, 9);
          speckle(x, y, ['#101a16'], 6);
          break;
        case T.DARK:
          fill(x, y, TILE, TILE, '#131e1a');
          speckle(x, y, ENV.moss, 8);
          speckle(x, y, ['#0d1512'], 8);
          break;
        case T.BORDER:
          fill(x, y, TILE, TILE, '#0b1310');
          speckle(x, y, ['#101a16'], 6);
          break;
        case T.DIRT:
          fill(x, y, TILE, TILE, rng.pick(ENV.dirt));
          speckle(x, y, ENV.dirtHi, 7);
          speckle(x, y, ['#1d171c'], 6);
          break;
        case T.STONE:
        case T.PILLAR:
        case T.WALL:
          drawStoneFloor(ctx, rng, x, y);
          break;
      }
    }
  }

  // Soften dirt path edges into the grass.
  for (let ty = 1; ty < N - 1; ty++) {
    for (let tx = 1; tx < N - 1; tx++) {
      if (map.tile(tx, ty) !== T.DIRT) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = map.tile(tx + dx, ty + dy);
        if (nt === T.DIRT || nt === T.WALL) continue;
        for (let i = 0; i < 10; i++) {
          const along = rng.int(0, 15);
          const depth = rng.int(0, 2) + (rng.chance(0.3) ? 1 : 0);
          const px = dx === 0 ? tx * TILE + along : dx > 0 ? (tx + 1) * TILE + depth : tx * TILE - 1 - depth;
          const py = dy === 0 ? ty * TILE + along : dy > 0 ? (ty + 1) * TILE + depth : ty * TILE - 1 - depth;
          fill(px, py, 1, 1, rng.pick(ENV.dirt));
        }
      }
    }
  }

  // Walls: a lighter top face with a darker front face.
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      if (map.tile(tx, ty) !== T.WALL) continue;
      const x = tx * TILE;
      const y = ty * TILE;
      const below = map.tile(tx, ty + 1) === T.WALL;
      fill(x, y - 4, TILE, 13, rng.pick(ENV.wallTop));
      for (let by = y - 4; by < y + 9; by += 4) {
        fill(x, by, TILE, 1, '#3a3550');
        const off = ((by - y) / 4) % 2 === 0 ? 0 : 5;
        for (let bx = x + off; bx < x + TILE; bx += 8) fill(bx, by, 1, 4, '#3a3550');
      }
      if (!below) {
        fill(x, y + 9, TILE, 6, rng.pick(ENV.wallFace));
        fill(x, y + 15, TILE, 1, '#07060c');
        for (let i = 0; i < 4; i++) fill(x + rng.int(0, 15), y + 10 + rng.int(0, 4), 1, 1, '#25213a');
      }
      if (map.tile(tx, ty - 1) !== T.WALL) fill(x, y - 5, TILE, 1, '#07060c');
      if (map.tile(tx - 1, ty) !== T.WALL) fill(x - 1, y - 4, 1, below ? 20 : 20, '#07060c');
      if (map.tile(tx + 1, ty) !== T.WALL) fill(x + TILE, y - 4, 1, below ? 20 : 20, '#07060c');
      if (rng.chance(0.25)) fill(x + rng.int(2, 13), y - 4, rng.int(1, 3), 1, '#2f5e34'); // moss
    }
  }

  // Shadows under props (trees, pillars).
  ctx.fillStyle = 'rgba(4, 3, 10, 0.45)';
  for (const p of map.props) {
    const w = p.kind === 'pine' || p.kind === 'round' ? 14 : 8;
    ellipse(ctx, p.x, p.y, w, 3);
  }

  // Decor.
  for (const d of map.decor) {
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    switch (d.kind) {
      case 'tuft':
        fill(x, y, 1, 2, '#2f5a3e');
        fill(x + 1, y - 1, 1, 3, '#3a6b4c');
        fill(x + 2, y + 1, 1, 1, '#2f5a3e');
        break;
      case 'flower': {
        const col = [ENV.flowerA, ENV.flowerB, ENV.flowerC][d.v % 3];
        fill(x, y + 1, 1, 2, '#2f5a3e');
        fill(x, y, 1, 1, col);
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

function drawStoneFloor(ctx, rng, x, y) {
  ctx.fillStyle = rng.pick(ENV.stone);
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = ENV.stoneLine;
  ctx.fillRect(x, y + 7, TILE, 1);
  ctx.fillRect(x, y + 15, TILE, 1);
  const o = rng.chance(0.5) ? 4 : 10;
  ctx.fillRect(x + o, y, 1, 7);
  ctx.fillRect(x + ((o + 6) % 16), y + 8, 1, 7);
  ctx.fillStyle = rng.pick(ENV.stoneHi);
  for (let i = 0; i < 5; i++) ctx.fillRect(x + rng.int(0, 15), y + rng.int(0, 15), 1, 1);
  if (rng.chance(0.3)) {
    ctx.fillStyle = '#24402f';
    ctx.fillRect(x + rng.int(0, 13), y + rng.int(0, 14), rng.int(1, 3), 1);
  }
}

export function ellipse(ctx, cx, cy, w, h) {
  for (let yy = -h; yy <= h; yy++) {
    const half = Math.round(w * Math.sqrt(Math.max(0, 1 - (yy * yy) / (h * h + 0.01))));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + yy), half * 2, 1);
  }
}
