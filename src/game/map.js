// Procedural map generation, tile collision and the enemy flow field.
// DOM-free so it can be unit tested in Node.

import { TILE, MAP_TILES, GATE_CLOSE_TIMES } from '../data/config.js';
import { RNG } from '../core/rng.js';
import { makeFractalNoise, makeNoise } from '../core/noise.js';
import { TAU, clamp } from '../core/math.js';

export const T = { GRASS: 0, DARK: 1, DIRT: 2, STONE: 3, WALL: 4, TREE: 5, BORDER: 6, PILLAR: 7 };
const SOLID = [false, false, false, false, true, true, true, true];

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class GameMap {
  constructor(seed) {
    this.seed = seed;
    this.n = MAP_TILES;
    this.size = MAP_TILES * TILE;
    this.tiles = new Uint8Array(this.n * this.n);
    this.reach = new Uint8Array(this.n * this.n);
    this.flow = new Uint16Array(this.n * this.n);
    this.flowQueue = new Int32Array(this.n * this.n);
    this.flowOrigin = -1;
    this.props = []; // y-sorted drawables: { kind, img, x, y }
    this.propRows = [];
    this.decor = []; // flat decorations baked into the ground
    this.torches = [];
    this.pois = [];
    this.cursedZones = [];
    this.generate(new RNG(seed));
  }

  idx(tx, ty) {
    return ty * this.n + tx;
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.n && ty < this.n;
  }

  tile(tx, ty) {
    return this.inBounds(tx, ty) ? this.tiles[this.idx(tx, ty)] : T.BORDER;
  }

  isSolid(tx, ty) {
    return !this.inBounds(tx, ty) || SOLID[this.tiles[this.idx(tx, ty)]];
  }

  isSolidAt(px, py) {
    return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  isOpenReachable(px, py) {
    const tx = Math.floor(px / TILE);
    const ty = Math.floor(py / TILE);
    return this.inBounds(tx, ty) && !this.isSolid(tx, ty) && this.reach[this.idx(tx, ty)] === 1;
  }

  // ── Generation ─────────────────────────────────────────────
  generate(rng) {
    const N = this.n;
    const tiles = this.tiles;
    const clear = new Uint8Array(N * N); // tiles that must stay walkable
    const forestN = makeFractalNoise(rng.fork(), 5, 3);
    const darkN = makeFractalNoise(rng.fork(), 7, 2);
    const ruinN = makeFractalNoise(rng.fork(), 4, 2);
    const borderN = makeNoise(rng.fork(), 14);
    const cx = Math.floor(N / 2);
    const cy = Math.floor(N / 2);
    this.spawn = { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };

    const markClear = (tx, ty, r) => {
      for (let y = ty - r; y <= ty + r; y++)
        for (let x = tx - r; x <= tx + r; x++)
          if (this.inBounds(x, y) && (x - tx) ** 2 + (y - ty) ** 2 <= r * r + r) clear[this.idx(x, y)] = 1;
    };
    markClear(cx, cy, 4);

    // Rift gates spread around the center.
    const closeTimes = rng.shuffle([...GATE_CLOSE_TIMES]);
    const base = rng.range(0, TAU);
    const gates = [];
    for (let i = 0; i < 3; i++) {
      const a = base + (i * TAU) / 3 + rng.range(-0.35, 0.35);
      const d = rng.range(27, 32);
      const tx = clamp(Math.round(cx + Math.cos(a) * d), 6, N - 7);
      const ty = clamp(Math.round(cy + Math.sin(a) * d), 6, N - 7);
      gates.push({ tx, ty });
      markClear(tx, ty, 3);
      this.pois.push({ type: 'gate', id: `gate${i}`, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, closesAt: closeTimes[i], open: true, radius: 12 });
    }

    // Candidate POI spots (dart throwing with spacing).
    const spots = [];
    for (let attempt = 0; attempt < 4000 && spots.length < 34; attempt++) {
      const tx = rng.int(7, N - 8);
      const ty = rng.int(7, N - 8);
      if ((tx - cx) ** 2 + (ty - cy) ** 2 < 8 * 8) continue;
      if (gates.some((g) => (g.tx - tx) ** 2 + (g.ty - ty) ** 2 < 7 * 7)) continue;
      if (spots.some((s) => (s.tx - tx) ** 2 + (s.ty - ty) ** 2 < 8 * 8)) continue;
      spots.push({ tx, ty });
    }
    rng.shuffle(spots);
    const take = () => spots.pop();
    const px = (s) => s.tx * TILE + TILE / 2;
    const py = (s) => s.ty * TILE + TILE / 2;

    // Treasure room: walled ruin, heavily guarded, great chest inside.
    const roomSpot = spots.find((s) => s.tx > 12 && s.tx < N - 13 && s.ty > 12 && s.ty < N - 13);
    if (roomSpot) {
      spots.splice(spots.indexOf(roomSpot), 1);
      this.buildTreasureRoom(rng, roomSpot.tx, roomSpot.ty, clear);
    }

    const cursed = take();
    if (cursed) {
      markClear(cursed.tx, cursed.ty, 2);
      const zone = { x: px(cursed), y: py(cursed), r: 88 };
      this.cursedZones.push(zone);
      this.pois.push({ type: 'chest', x: zone.x, y: zone.y, rarity: 'epic', cursed: true, opened: false, radius: 10 });
    }
    for (let i = 0; i < 3; i++) {
      const s = take();
      if (!s) break;
      markClear(s.tx, s.ty, 2);
      this.pois.push({ type: 'camp', x: px(s), y: py(s), spawned: false, radius: 0 });
      this.pois.push({ type: 'chest', x: px(s), y: py(s) - 4, rarity: rng.chance(0.4) ? 'rare' : 'uncommon', opened: false, radius: 10 });
      this.torches.push({ x: px(s) - 18, y: py(s) + 6 }, { x: px(s) + 18, y: py(s) + 6 });
    }
    const shrineKinds = rng.shuffle(['blood', 'greed', 'fortune', 'haste']);
    for (let i = 0; i < 3; i++) {
      const s = take();
      if (!s) break;
      markClear(s.tx, s.ty, 2);
      this.pois.push({ type: 'shrine', kind: shrineKinds[i], x: px(s), y: py(s), used: false, radius: 12 });
    }
    for (let i = 0; i < 3; i++) {
      const s = take();
      if (!s) break;
      markClear(s.tx, s.ty, 2);
      this.pois.push({ type: 'mystery', x: px(s), y: py(s), used: false, radius: 11 });
    }
    for (let i = 0; i < 2; i++) {
      const s = take();
      if (!s) break;
      markClear(s.tx, s.ty, 3);
      this.pois.push({ type: 'ambush', x: px(s), y: py(s), triggered: false, radius: 22 });
      // Subtle warning signs: scattered bones.
      for (let k = 0; k < 4; k++) this.decor.push({ kind: 'bones', x: px(s) + rng.range(-20, 20), y: py(s) + rng.range(-16, 16) });
    }
    while (spots.length > 0 && this.pois.filter((p) => p.type === 'chest').length < 14) {
      const s = take();
      markClear(s.tx, s.ty, 1);
      this.pois.push({ type: 'chest', x: px(s), y: py(s), rarity: rng.chance(0.18) ? 'uncommon' : 'common', opened: false, radius: 10 });
    }

    // Dirt paths from the center to each gate and to a few points of interest.
    for (const g of gates) this.carvePath(rng, cx, cy, g.tx, g.ty, clear);
    const someTargets = rng.shuffle(this.pois.filter((p) => p.type !== 'gate')).slice(0, 4);
    for (const p of someTargets) this.carvePath(rng, cx, cy, Math.floor(p.x / TILE), Math.floor(p.y / TILE), clear);

    // Terrain pass.
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const i = this.idx(tx, ty);
        const u = tx / N;
        const v = ty / N;
        const edge = Math.min(tx, ty, N - 1 - tx, N - 1 - ty);
        if (edge < 3 + Math.floor(borderN(u, v) * 2.5)) {
          tiles[i] = T.BORDER;
          continue;
        }
        if (tiles[i] !== T.GRASS) continue; // already a path / ruin
        if (clear[i]) continue;
        const nearSpawn = (tx - cx) ** 2 + (ty - cy) ** 2 < 6 * 6;
        const ruin = ruinN(u, v);
        if (ruin > 0.66 && !nearSpawn) {
          tiles[i] = T.STONE;
          continue;
        }
        const f = forestN(u, v);
        if (!nearSpawn && ((f > 0.57 && rng.chance(0.86)) || rng.chance(0.022))) {
          tiles[i] = T.TREE;
          continue;
        }
        if (darkN(u, v) > 0.56) tiles[i] = T.DARK;
      }
    }

    // Broken walls and pillars on ruin patches.
    for (let k = 0; k < 220; k++) {
      const tx = rng.int(4, N - 5);
      const ty = rng.int(4, N - 5);
      if (tiles[this.idx(tx, ty)] !== T.STONE) continue;
      if (rng.chance(0.3)) {
        if (!clear[this.idx(tx, ty)]) tiles[this.idx(tx, ty)] = T.PILLAR;
        continue;
      }
      const horiz = rng.chance(0.5);
      const len = rng.int(2, 4);
      for (let j = 0; j < len; j++) {
        const x = tx + (horiz ? j : 0);
        const y = ty + (horiz ? 0 : j);
        const ii = this.idx(x, y);
        if (!this.inBounds(x, y) || clear[ii] || tiles[ii] === T.BORDER) break;
        tiles[ii] = T.WALL;
      }
      if (rng.chance(0.5)) this.decor.push({ kind: 'grave', x: tx * TILE + rng.range(2, 14), y: ty * TILE + 16 + rng.range(4, 12) });
    }

    this.ensureConnectivity(cx, cy);

    // Props for y-sorted drawing.
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const t = tiles[this.idx(tx, ty)];
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE - 1;
        if (t === T.TREE || t === T.BORDER) {
          // Only draw border trees that could ever be seen (near the playable area).
          const edge = Math.min(tx, ty, N - 1 - tx, N - 1 - ty);
          if (t === T.BORDER && edge < 1 && rng.chance(0.5)) continue;
          const roll = rng.next();
          const kind = t === T.BORDER || roll < 0.6 ? 'pine' : roll < 0.85 ? 'round' : 'dead';
          this.props.push({ kind, variant: rng.int(0, 7), x: x + rng.int(-2, 2), y: y + rng.int(-1, 1) });
        } else if (t === T.PILLAR) {
          this.props.push({ kind: rng.chance(0.65) ? 'pillar' : 'pillarBroken', x, y });
        }
      }
    }

    // Flat decor.
    for (let k = 0; k < 900; k++) {
      const tx = rng.int(3, N - 4);
      const ty = rng.int(3, N - 4);
      const t = tiles[this.idx(tx, ty)];
      if (t !== T.GRASS && t !== T.DARK) continue;
      const roll = rng.next();
      const kind = roll < 0.55 ? 'tuft' : roll < 0.75 ? 'flower' : roll < 0.87 ? 'bush' : roll < 0.95 ? 'rock' : 'mushroom';
      this.decor.push({ kind, x: tx * TILE + rng.range(2, 14), y: ty * TILE + rng.range(2, 14), v: rng.int(0, 7) });
    }
    for (const g of this.pois.filter((p) => p.type === 'gate')) {
      this.torches.push({ x: g.x - 20, y: g.y + 10 }, { x: g.x + 20, y: g.y + 10 });
    }

    this.propRows = Array.from({ length: N }, () => []);
    for (const p of this.props) this.propRows[clamp(Math.floor(p.y / TILE), 0, N - 1)].push(p);
  }

  buildTreasureRoom(rng, tx, ty, clear) {
    const w = 11;
    const h = 9;
    const x0 = tx - Math.floor(w / 2);
    const y0 = ty - Math.floor(h / 2);
    const openings = rng.chance(0.5) ? ['top', 'bottom'] : ['left', 'right'];
    for (let y = y0 - 1; y <= y0 + h; y++) {
      for (let x = x0 - 1; x <= x0 + w; x++) {
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        clear[i] = 1;
        const onEdge = x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1;
        const inside = x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
        if (!inside) {
          this.tiles[i] = T.DIRT;
          continue;
        }
        let gap = false;
        const midX = x0 + Math.floor(w / 2);
        const midY = y0 + Math.floor(h / 2);
        if (openings.includes('top') && y === y0 && Math.abs(x - midX) <= 1) gap = true;
        if (openings.includes('bottom') && y === y0 + h - 1 && Math.abs(x - midX) <= 1) gap = true;
        if (openings.includes('left') && x === x0 && Math.abs(y - midY) <= 1) gap = true;
        if (openings.includes('right') && x === x0 + w - 1 && Math.abs(y - midY) <= 1) gap = true;
        this.tiles[i] = onEdge && !gap ? T.WALL : T.STONE;
      }
    }
    const cxp = tx * TILE + TILE / 2;
    const cyp = ty * TILE + TILE / 2;
    this.pois.push({ type: 'chest', x: cxp, y: cyp, rarity: rng.chance(0.25) ? 'legendary' : 'epic', treasure: true, opened: false, radius: 10 });
    this.pois.push({ type: 'treasureGuard', x: cxp, y: cyp, spawned: false, radius: 0 });
    this.torches.push({ x: x0 * TILE + 24, y: y0 * TILE + 28 }, { x: (x0 + w) * TILE - 24, y: y0 * TILE + 28 });
    this.torches.push({ x: x0 * TILE + 24, y: (y0 + h) * TILE - 20 }, { x: (x0 + w) * TILE - 24, y: (y0 + h) * TILE - 20 });
  }

  carvePath(rng, fx, fy, tx, ty, clear) {
    let x = fx;
    let y = fy;
    let guard = 0;
    while ((x !== tx || y !== ty) && guard++ < 400) {
      const dx = Math.sign(tx - x);
      const dy = Math.sign(ty - y);
      let horizontal;
      if (rng.chance(0.14)) {
        // wander sideways for organic paths
        horizontal = rng.chance(0.5);
        if (horizontal) x += rng.sign();
        else y += rng.sign();
      } else if (Math.abs(tx - x) > Math.abs(ty - y) ? rng.chance(0.75) : rng.chance(0.25)) {
        horizontal = true;
        x += dx;
      } else {
        horizontal = false;
        y += dy;
      }
      x = clamp(x, 4, this.n - 5);
      y = clamp(y, 4, this.n - 5);
      for (const [ox, oy] of horizontal ? [[0, 0], [0, 1]] : [[0, 0], [1, 0]]) {
        const i = this.idx(x + ox, y + oy);
        if (this.tiles[i] === T.GRASS || this.tiles[i] === T.DARK) this.tiles[i] = T.DIRT;
        clear[i] = 1;
      }
    }
  }

  floodReach(cx, cy) {
    const N = this.n;
    this.reach.fill(0);
    const q = this.flowQueue;
    let head = 0;
    let tail = 0;
    const start = this.idx(cx, cy);
    this.reach[start] = 1;
    q[tail++] = start;
    while (head < tail) {
      const i = q[head++];
      const x = i % N;
      const y = (i / N) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.inBounds(nx, ny) || this.isSolid(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (this.reach[ni]) continue;
        this.reach[ni] = 1;
        q[tail++] = ni;
      }
    }
  }

  ensureConnectivity(cx, cy) {
    for (let pass = 0; pass < 3; pass++) {
      this.floodReach(cx, cy);
      let carved = false;
      for (const p of this.pois) {
        let x = Math.floor(p.x / TILE);
        let y = Math.floor(p.y / TILE);
        if (this.reach[this.idx(x, y)] && !this.isSolid(x, y)) continue;
        // Carve a straight corridor toward the center until we hit reachable ground.
        let guard = 0;
        while (guard++ < 200) {
          const i = this.idx(x, y);
          if (this.isSolid(x, y)) this.tiles[i] = T.DIRT;
          if (this.reach[i]) break;
          if (x !== cx && (Math.abs(cx - x) >= Math.abs(cy - y) || y === cy)) x += Math.sign(cx - x);
          else y += Math.sign(cy - y);
        }
        carved = true;
      }
      if (!carved) break;
    }
    this.floodReach(cx, cy);
  }

  // ── Collision ─────────────────────────────────────────────
  /**
   * Push a circle (e.x, e.y, e.radius) out of solid tiles. Returns true if it hit something.
   * When the previous position is given, the center is also never allowed to enter a solid
   * tile or cut diagonally between two solid tiles — otherwise circles could squeeze through
   * the gaps between inset tree trunks into pockets enemies can't path into.
   */
  collide(e, prevX = null, prevY = null) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const r = e.radius;
      const minTx = Math.floor((e.x - r) / TILE);
      const maxTx = Math.floor((e.x + r) / TILE);
      const minTy = Math.floor((e.y - r) / TILE);
      const maxTy = Math.floor((e.y + r) / TILE);
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          if (!this.isSolid(tx, ty)) continue;
          const t = this.tile(tx, ty);
          const inset = t === T.TREE || t === T.PILLAR ? 3 : 0;
          const bx0 = tx * TILE + inset;
          const bx1 = (tx + 1) * TILE - inset;
          const by0 = ty * TILE + (inset ? 5 : 0);
          const by1 = (ty + 1) * TILE - (inset ? 1 : 0);
          const nx = clamp(e.x, bx0, bx1);
          const ny = clamp(e.y, by0, by1);
          let dx = e.x - nx;
          let dy = e.y - ny;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          hit = true;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = r - d;
            e.x += (dx / d) * push;
            e.y += (dy / d) * push;
          } else {
            // Center inside the box: exit through the nearest face.
            const left = e.x - bx0;
            const right = bx1 - e.x;
            const top = e.y - by0;
            const bottom = by1 - e.y;
            const m = Math.min(left, right, top, bottom);
            if (m === left) e.x = bx0 - r;
            else if (m === right) e.x = bx1 + r;
            else if (m === top) e.y = by0 - r;
            else e.y = by1 + r;
          }
        }
      }
    }
    if (prevX !== null) {
      const tx = Math.floor(e.x / TILE);
      const ty = Math.floor(e.y / TILE);
      const ptx = Math.floor(prevX / TILE);
      const pty = Math.floor(prevY / TILE);
      const cornerCut = tx !== ptx && ty !== pty && this.isSolid(tx, pty) && this.isSolid(ptx, ty);
      if (this.isSolid(tx, ty) || cornerCut) {
        hit = true;
        if (!this.isSolid(tx, pty) && !cornerCut) e.y = prevY;
        else if (!this.isSolid(ptx, ty) && !cornerCut) e.x = prevX;
        else {
          e.x = prevX;
          e.y = prevY;
        }
      }
    }
    return hit;
  }

  // ── Flow field toward the player ────────────────────────────
  computeFlow(px, py) {
    const N = this.n;
    const tx = clamp(Math.floor(px / TILE), 0, N - 1);
    const ty = clamp(Math.floor(py / TILE), 0, N - 1);
    const origin = this.idx(tx, ty);
    if (origin === this.flowOrigin) return;
    this.flowOrigin = origin;
    const dist = this.flow;
    dist.fill(65535);
    const q = this.flowQueue;
    let head = 0;
    let tail = 0;
    dist[origin] = 0;
    q[tail++] = origin;
    while (head < tail) {
      const i = q[head++];
      const x = i % N;
      const y = (i / N) | 0;
      const d = dist[i] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = x + DIRS4[k][0];
        const ny = y + DIRS4[k][1];
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        const ni = ny * N + nx;
        if (dist[ni] <= d || SOLID[this.tiles[ni]]) continue;
        dist[ni] = d;
        q[tail++] = ni;
      }
    }
  }

  /** Direction (unit vector into `out`) an enemy at (x, y) should walk to reach the player. */
  flowDir(x, y, out) {
    const N = this.n;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (!this.inBounds(tx, ty)) return false;
    let best = this.flow[this.idx(tx, ty)];
    if (best === 65535) return false;
    let bx = 0;
    let by = 0;
    for (const [dx, dy] of DIRS8) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (!this.inBounds(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (this.isSolid(tx + dx, ty) || this.isSolid(tx, ty + dy))) continue;
      const d = this.flow[ny * N + nx];
      if (d < best) {
        best = d;
        bx = dx;
        by = dy;
      }
    }
    if (bx === 0 && by === 0) return false;
    const targetX = (tx + bx) * TILE + TILE / 2;
    const targetY = (ty + by) * TILE + TILE / 2;
    const vx = targetX - x;
    const vy = targetY - y;
    const len = Math.hypot(vx, vy) || 1;
    out.x = vx / len;
    out.y = vy / len;
    return true;
  }

  /** Find a reachable open point in a ring around (cx, cy). */
  findOpenPoint(rng, cx, cy, minR, maxR, tries = 16) {
    for (let i = 0; i < tries; i++) {
      const a = rng.range(0, TAU);
      const d = rng.range(minR, maxR);
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      if (x < TILE * 2 || y < TILE * 2 || x > this.size - TILE * 2 || y > this.size - TILE * 2) continue;
      if (this.isOpenReachable(x, y)) return { x, y };
    }
    return null;
  }

  inCursedZone(x, y) {
    for (const z of this.cursedZones) if ((x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return z;
    return null;
  }
}
