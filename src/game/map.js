// Procedural map generation, tile collision and the enemy flow field.
// DOM-free so it can be unit tested in Node. Each region (biome) shapes
// the generator: map size, layout, terrain, pools of ice or lava, trees.

import { TILE, GATE_CLOSE_TIMES } from '../data/config.js';
import { BIOMES } from '../data/biomes.js';
import { LANDMARKS, orient } from '../data/landmarks.js';
import { RNG } from '../core/rng.js';
import { makeFractalNoise, makeNoise } from '../core/noise.js';
import { TAU, clamp } from '../core/math.js';

export const T = { GRASS: 0, DARK: 1, DIRT: 2, STONE: 3, WALL: 4, TREE: 5, BORDER: 6, PILLAR: 7, ICE: 8, LAVA: 9, COBBLE: 10 };
const SOLID = [false, false, false, false, true, true, true, true, false, false, false];

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class GameMap {
  /**
   * @param {number} seed
   * @param {object} [biome] entry from BIOMES (defaults to the forest)
   * @param {{custom?: (map: GameMap, rng: RNG) => void}} [opts] custom builder (used by the town)
   */
  constructor(seed, biome = BIOMES.forest, opts = {}) {
    this.seed = seed;
    this.biome = biome;
    this.n = opts.size || biome.size;
    this.size = this.n * TILE;
    this.tiles = new Uint8Array(this.n * this.n);
    this.reach = new Uint8Array(this.n * this.n);
    this.flow = new Uint16Array(this.n * this.n);
    this.flowQueue = new Int32Array(this.n * this.n);
    this.flowOrigin = -1;
    this.props = []; // y-sorted drawables
    this.propRows = [];
    this.decor = []; // flat decorations baked into the ground
    this.torches = [];
    this.pois = [];
    this.cursedZones = [];
    this.spikes = [];
    this.landmarks = [];
    this.landmarkMask = new Uint8Array(this.n * this.n); // paths never carve through set pieces
    this.floorTile = biome.layout === 'rooms' ? T.STONE : T.DIRT;
    const rng = new RNG(seed);
    if (opts.custom) opts.custom(this, rng);
    else if (biome.layout === 'rooms') this.generateRooms(rng);
    else this.generateWilds(rng);
    this.finish(rng, !opts.custom);
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

  tileAt(px, py) {
    return this.tile(Math.floor(px / TILE), Math.floor(py / TILE));
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

  /** Reachable, walkable and not a hazard (for spawning things). */
  isSafeOpen(px, py) {
    const t = this.tileAt(px, py);
    return this.isOpenReachable(px, py) && t !== T.LAVA;
  }

  markClear(clear, tx, ty, r) {
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++)
        if (this.inBounds(x, y) && (x - tx) ** 2 + (y - ty) ** 2 <= r * r + r) clear[this.idx(x, y)] = 1;
  }

  // ── Open-world layout (forest, tundra, caldera) ───────────
  generateWilds(rng) {
    const N = this.n;
    const tiles = this.tiles;
    const g = this.biome.gen;
    const clear = new Uint8Array(N * N); // tiles that must stay walkable
    const forestN = makeFractalNoise(rng.fork(), Math.round(N / 16), 3);
    const darkN = makeFractalNoise(rng.fork(), Math.round(N / 11), 2);
    const ruinN = makeFractalNoise(rng.fork(), Math.round(N / 20), 2);
    const poolN = makeFractalNoise(rng.fork(), Math.round(N / 14), 3);
    const borderN = makeNoise(rng.fork(), 14);
    const cx = Math.floor(N / 2);
    const cy = Math.floor(N / 2);
    this.center = { tx: cx, ty: cy };
    this.spawn = { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };
    this.markClear(clear, cx, cy, 4);

    // Rift gates spread around the center.
    const gates = this.placeGates(rng, cx, cy, N * 0.34, N * 0.4, clear);

    // Candidate POI spots (dart throwing with spacing).
    const area = (N / 80) ** 2;
    const spots = [];
    for (let attempt = 0; attempt < 6000 && spots.length < Math.round(34 * area); attempt++) {
      const tx = rng.int(7, N - 8);
      const ty = rng.int(7, N - 8);
      if ((tx - cx) ** 2 + (ty - cy) ** 2 < 8 * 8) continue;
      if (gates.some((gt) => (gt.tx - tx) ** 2 + (gt.ty - ty) ** 2 < 7 * 7)) continue;
      if (spots.some((s) => (s.tx - tx) ** 2 + (s.ty - ty) ** 2 < 8 * 8)) continue;
      spots.push({ tx, ty });
    }
    rng.shuffle(spots);

    // Treasure room: walled ruin, heavily guarded, great chest inside.
    const roomSpot = spots.find((s) => s.tx > 12 && s.tx < N - 13 && s.ty > 12 && s.ty < N - 13);
    if (roomSpot) {
      spots.splice(spots.indexOf(roomSpot), 1);
      this.buildTreasureRoom(rng, roomSpot.tx, roomSpot.ty, clear);
    }
    // The region's set pieces, away from the start, the gates and the vault.
    for (const lm of rng.shuffle([...(LANDMARKS[this.biome.id] || [])])) {
      const spot = spots.find(
        (s) =>
          s.tx > 13 && s.tx < N - 14 && s.ty > 13 && s.ty < N - 14 &&
          (s.tx - cx) ** 2 + (s.ty - cy) ** 2 > 16 * 16 &&
          gates.every((gt) => (gt.tx - s.tx) ** 2 + (gt.ty - s.ty) ** 2 > 12 * 12) &&
          (!roomSpot || (roomSpot.tx - s.tx) ** 2 + (roomSpot.ty - s.ty) ** 2 > 16 * 16) &&
          this.landmarks.every((o) => (o.tx - s.tx) ** 2 + (o.ty - s.ty) ** 2 > 22 * 22),
      );
      if (!spot) continue;
      this.stampLandmark(rng, lm, spot.tx, spot.ty, clear, true);
      // Keep other points of interest out of the set piece.
      for (let k = spots.length - 1; k >= 0; k--) if ((spots[k].tx - spot.tx) ** 2 + (spots[k].ty - spot.ty) ** 2 < 9 * 9) spots.splice(k, 1);
    }
    this.placePois(rng, spots, clear, area);

    // Dirt paths from the center to each gate and to a few points of interest.
    for (const gt of gates) this.carvePath(rng, cx, cy, gt.tx, gt.ty, clear);
    const someTargets = rng.shuffle(this.pois.filter((p) => p.type !== 'gate')).slice(0, Math.round(4 * area));
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
        const nearSpawn = (tx - cx) ** 2 + (ty - cy) ** 2 < 7 * 7;
        if (g.pools && !nearSpawn && poolN(u, v) > g.pools.threshold) {
          tiles[i] = g.pools.tile === 'lava' ? T.LAVA : T.ICE;
          continue;
        }
        if (ruinN(u, v) > g.ruins && !nearSpawn) {
          tiles[i] = T.STONE;
          continue;
        }
        const f = forestN(u, v);
        if (!nearSpawn && ((f > g.forest && rng.chance(g.forestChance)) || rng.chance(g.scatter))) {
          tiles[i] = T.TREE;
          continue;
        }
        if (darkN(u, v) > g.dark) tiles[i] = T.DARK;
      }
    }

    // Broken walls and pillars on ruin patches.
    for (let k = 0; k < Math.round(220 * area); k++) {
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
    this.scatterBraziers(rng, Math.round(9 * area), [T.STONE, T.DIRT]);
  }

  // ── Dungeon layout (crypt): rooms joined by corridors ─────
  generateRooms(rng) {
    const N = this.n;
    const tiles = this.tiles;
    tiles.fill(T.WALL);
    for (let ty = 0; ty < N; ty++)
      for (let tx = 0; tx < N; tx++) if (Math.min(tx, ty, N - 1 - tx, N - 1 - ty) < 2) tiles[this.idx(tx, ty)] = T.BORDER;
    const clear = new Uint8Array(N * N);
    const cx = Math.floor(N / 2);
    const cy = Math.floor(N / 2);
    this.center = { tx: cx, ty: cy };
    this.spawn = { x: cx * TILE + TILE / 2, y: cy * TILE + TILE / 2 };

    const rooms = [{ x: cx - 4, y: cy - 4, w: 9, h: 9, start: true }];
    const overlaps = (r) => rooms.some((o) => r.x < o.x + o.w + 3 && r.x + r.w + 3 > o.x && r.y < o.y + o.h + 3 && r.y + r.h + 3 > o.y);
    for (let attempt = 0; attempt < 900 && rooms.length < 34; attempt++) {
      const w = rng.int(6, 13);
      const h = rng.int(6, 11);
      const r = { x: rng.int(4, N - w - 5), y: rng.int(4, N - h - 5), w, h };
      if (!overlaps(r)) rooms.push(r);
    }
    const carveRect = (x0, y0, w, h) => {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (this.inBounds(x, y) && tiles[this.idx(x, y)] !== T.BORDER) tiles[this.idx(x, y)] = T.STONE;
    };
    for (const r of rooms) carveRect(r.x, r.y, r.w, r.h);
    // Connect every room to its nearest already-connected room (a spanning tree), plus a few loops.
    const centerOf = (r) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });
    const connected = [rooms[0]];
    const corridor = (a, b) => {
      const ca = centerOf(a);
      const cb = centerOf(b);
      const horizFirst = rng.chance(0.5);
      const wdt = rng.chance(0.3) ? 3 : 2;
      const hLine = (y, x0, x1) => carveRect(Math.min(x0, x1), y, Math.abs(x1 - x0) + wdt, wdt);
      const vLine = (x, y0, y1) => carveRect(x, Math.min(y0, y1), wdt, Math.abs(y1 - y0) + wdt);
      if (horizFirst) {
        hLine(ca.y, ca.x, cb.x);
        vLine(cb.x, ca.y, cb.y);
      } else {
        vLine(ca.x, ca.y, cb.y);
        hLine(cb.y, ca.x, cb.x);
      }
      // Spike traps in some corridors.
      if (rng.chance(0.45)) {
        const mx = horizFirst ? Math.round((ca.x + cb.x) / 2) : ca.x;
        const my = horizFirst ? ca.y : Math.round((ca.y + cb.y) / 2);
        for (let k = 0; k < wdt; k++) {
          const sx = horizFirst ? mx : mx + k;
          const sy = horizFirst ? my + k : my;
          this.spikes.push({ tx: sx, ty: sy, x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2, phase: (mx + my) % 3 });
        }
      }
    };
    for (const r of rooms.slice(1)) {
      let best = connected[0];
      let bd = Infinity;
      const c = centerOf(r);
      for (const o of connected) {
        const oc = centerOf(o);
        const d = (oc.x - c.x) ** 2 + (oc.y - c.y) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      corridor(r, best);
      connected.push(r);
    }
    for (let k = 0; k < 6; k++) corridor(rng.pick(rooms), rng.pick(rooms));
    this.rooms = rooms;
    this.markClear(clear, cx, cy, 3);

    // Gates in the three rooms farthest from the start, spread apart.
    const byDist = rooms.slice(1).sort((a, b) => {
      const ca = centerOf(a);
      const cb = centerOf(b);
      return (cb.x - cx) ** 2 + (cb.y - cy) ** 2 - ((ca.x - cx) ** 2 + (ca.y - cy) ** 2);
    });
    const gateRooms = [];
    for (const r of byDist) {
      const c = centerOf(r);
      if (gateRooms.every((o) => (centerOf(o).x - c.x) ** 2 + (centerOf(o).y - c.y) ** 2 > (N * 0.3) ** 2)) gateRooms.push(r);
      if (gateRooms.length === 3) break;
    }
    for (const r of byDist) if (gateRooms.length < 3 && !gateRooms.includes(r)) gateRooms.push(r);
    const closeTimes = rng.shuffle([...GATE_CLOSE_TIMES]);
    gateRooms.forEach((r, i) => {
      const c = centerOf(r);
      this.markClear(clear, c.x, c.y, 2);
      this.pois.push({ type: 'gate', id: `gate${i}`, x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, closesAt: closeTimes[i], open: true, radius: 12 });
      this.torches.push({ x: c.x * TILE - 12, y: c.y * TILE + 26 }, { x: c.x * TILE + 28, y: c.y * TILE + 26 });
    });
    for (const r of rooms) r.used = gateRooms.includes(r) || r.start;
    // The Toll Gate sits in a room about halfway out.
    const midRooms = byDist.filter((r) => !r.used);
    const tollRoom = midRooms[Math.floor(midRooms.length * 0.6)];
    if (tollRoom) {
      tollRoom.used = true;
      const c = centerOf(tollRoom);
      this.markClear(clear, c.x, c.y, 2);
      this.pois.push({ type: 'gate', id: 'toll', toll: true, x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, closesAt: null, open: true, radius: 12 });
      this.torches.push({ x: c.x * TILE - 12, y: c.y * TILE + 26 }, { x: c.x * TILE + 28, y: c.y * TILE + 26 });
    }

    // The biggest unused room becomes the treasure vault.
    const vault = rooms.filter((r) => !r.used).sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (vault) {
      vault.used = true;
      const c = centerOf(vault);
      this.markClear(clear, c.x, c.y, 2);
      this.pois.push({ type: 'chest', x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, rarity: rng.chance(0.25) ? 'legendary' : 'epic', treasure: true, opened: false, radius: 10 });
      this.pois.push({ type: 'treasureGuard', x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2, spawned: false, radius: 0 });
      this.torches.push({ x: vault.x * TILE + 10, y: vault.y * TILE + 14 }, { x: (vault.x + vault.w) * TILE - 10, y: vault.y * TILE + 14 });
    }

    // Set pieces fill a couple of the remaining rooms.
    for (const lm of rng.shuffle([...(LANDMARKS[this.biome.id] || [])])) {
      const th = lm.rows.length;
      const tw = lm.rows[0].length;
      const room = rng.shuffle(rooms.filter((r) => !r.used && r.w >= tw + 2 && r.h >= th + 2))[0];
      if (!room) continue;
      room.used = true;
      const c = centerOf(room);
      this.stampLandmark(rng, lm, c.x, c.y, clear, false);
    }

    // Other points of interest go in room interiors.
    const spots = [];
    for (const r of rooms) {
      if (r.used) continue;
      const tries = Math.max(1, Math.floor((r.w * r.h) / 40));
      for (let k = 0; k < tries; k++) spots.push({ tx: rng.int(r.x + 2, r.x + r.w - 3), ty: rng.int(r.y + 2, r.y + r.h - 3) });
      if (rng.chance(0.5)) this.torches.push({ x: (r.x + 1) * TILE, y: (r.y + 1) * TILE + 8 });
    }
    rng.shuffle(spots);
    this.placePois(rng, spots, clear, (N / 80) ** 2);

    // Pillars inside large rooms.
    for (const r of rooms) {
      if (r.w < 9 || r.h < 8 || r.start) continue;
      for (const [px, py] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) {
        if (!clear[this.idx(px, py)] && rng.chance(0.7)) tiles[this.idx(px, py)] = T.PILLAR;
      }
    }
    this.scatterBraziers(rng, Math.round(rooms.length * 0.35), [T.STONE]);
    // Spikes never sit on points of interest.
    this.spikes = this.spikes.filter((s) => !clear[this.idx(s.tx, s.ty)] && tiles[this.idx(s.tx, s.ty)] === T.STONE);
  }

  placeGates(rng, cx, cy, dMin, dMax, clear) {
    const N = this.n;
    const closeTimes = rng.shuffle([...GATE_CLOSE_TIMES]);
    const base = rng.range(0, TAU);
    const gates = [];
    for (let i = 0; i < 3; i++) {
      const a = base + (i * TAU) / 3 + rng.range(-0.35, 0.35);
      const d = rng.range(dMin, dMax);
      const tx = clamp(Math.round(cx + Math.cos(a) * d), 6, N - 7);
      const ty = clamp(Math.round(cy + Math.sin(a) * d), 6, N - 7);
      gates.push({ tx, ty });
      this.markClear(clear, tx, ty, 3);
      this.pois.push({ type: 'gate', id: `gate${i}`, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, closesAt: closeTimes[i], open: true, radius: 12 });
    }
    // The Toll Gate: closer than the others and never collapses, but it takes a cut of your gold.
    const a = base + TAU / 6;
    const d = rng.range(N * 0.2, N * 0.25);
    const tx = clamp(Math.round(cx + Math.cos(a) * d), 6, N - 7);
    const ty = clamp(Math.round(cy + Math.sin(a) * d), 6, N - 7);
    gates.push({ tx, ty });
    this.markClear(clear, tx, ty, 3);
    this.pois.push({ type: 'gate', id: 'toll', toll: true, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, closesAt: null, open: true, radius: 12 });
    return gates;
  }

  /**
   * Stamp a hand-made set piece (see landmarks.js) centered on a tile, mirrored
   * and rotated at random. Adds its chest, braziers, campfire, guards and name.
   */
  stampLandmark(rng, lm, tx, ty, clear, canRotate) {
    const rows = orient(lm.rows, { flipX: rng.chance(0.5), flipY: rng.chance(0.5), transpose: canRotate && rng.chance(0.5) });
    const h = rows.length;
    const w = rows[0].length;
    const x0 = tx - Math.floor(w / 2);
    const y0 = ty - Math.floor(h / 2);
    const pools = this.biome.gen && this.biome.gen.pools;
    const pool = pools ? (pools.tile === 'lava' ? T.LAVA : T.ICE) : T.DARK;
    const ground = this.biome.layout === 'rooms' ? T.STONE : T.GRASS;
    const at = (x, y) => ({ x: (x0 + x) * TILE + TILE / 2, y: (y0 + y) * TILE + TILE / 2 });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === ' ') continue;
        const X = x0 + x;
        const Y = y0 + y;
        if (!this.inBounds(X, Y) || this.tiles[this.idx(X, Y)] === T.BORDER) continue;
        const i = this.idx(X, Y);
        clear[i] = 1;
        this.landmarkMask[i] = 1;
        const tile = { '.': ground, ':': T.DIRT, s: T.STONE, '#': T.WALL, P: T.PILLAR, T: T.TREE, '~': pool, '?': rng.chance(0.5) ? T.WALL : T.STONE }[ch];
        this.tiles[i] = tile === undefined ? T.STONE : tile;
        const p = at(x, y);
        if (ch === 'C') this.pois.push({ type: 'chest', x: p.x, y: p.y, rarity: lm.chest, opened: false, radius: 10, landmark: lm.id });
        else if (ch === 'F') this.pois.push({ type: 'brazier', x: p.x, y: p.y + 4, lit: true, radius: 0 });
        else if (ch === 'K') this.pois.push({ type: 'camp', x: p.x, y: p.y, spawned: true, radius: 0 });
        else if (ch === 'B') this.decor.push({ kind: 'bones', x: p.x + rng.range(-3, 3), y: p.y + rng.range(-3, 3) });
        else if (ch === 'G') this.decor.push({ kind: 'grave', x: p.x, y: p.y + 6 });
      }
    }
    const c = at(Math.floor(w / 2), Math.floor(h / 2));
    if (lm.guard) this.pois.push({ type: 'landmarkGuard', x: c.x, y: c.y, spawned: false, radius: 0 });
    this.pois.push({ type: 'landmark', id: lm.id, name: lm.name, x: c.x, y: c.y, labelY: y0 * TILE + 2, radius: 0 });
    this.landmarks.push({ id: lm.id, tx, ty, w, h });
  }

  /** Braziers: light sources you can smash for a little loot (the area goes dark). */
  scatterBraziers(rng, count, onTiles) {
    const N = this.n;
    let placed = 0;
    for (let k = 0; k < count * 40 && placed < count; k++) {
      const tx = rng.int(5, N - 6);
      const ty = rng.int(5, N - 6);
      if (!onTiles.includes(this.tiles[this.idx(tx, ty)]) || this.landmarkMask[this.idx(tx, ty)]) continue;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2 + 4;
      if (this.pois.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < 40 * 40)) continue;
      this.pois.push({ type: 'brazier', x, y, lit: true, radius: 0 });
      placed++;
    }
  }

  /** Camps, shrines, mysterious chests, ambush sites, a cursed zone and chests, scaled by map area. */
  placePois(rng, spots, clear, area) {
    const take = () => spots.pop();
    const px = (s) => s.tx * TILE + TILE / 2;
    const py = (s) => s.ty * TILE + TILE / 2;
    const count = (base, max) => Math.min(max, Math.max(1, Math.round(base * area)));

    for (let i = 0; i < (area > 1.5 ? 2 : 1); i++) {
      const cursed = take();
      if (!cursed) break;
      this.markClear(clear, cursed.tx, cursed.ty, 2);
      const zone = { x: px(cursed), y: py(cursed), r: 88 };
      this.cursedZones.push(zone);
      this.pois.push({ type: 'chest', x: zone.x, y: zone.y, rarity: 'epic', cursed: true, opened: false, radius: 10 });
    }
    for (let i = 0; i < count(3, 5); i++) {
      const s = take();
      if (!s) break;
      this.markClear(clear, s.tx, s.ty, 2);
      this.pois.push({ type: 'camp', x: px(s), y: py(s), spawned: false, radius: 0 });
      this.pois.push({ type: 'chest', x: px(s), y: py(s) - 4, rarity: rng.chance(0.4) ? 'rare' : 'uncommon', opened: false, radius: 10 });
      this.torches.push({ x: px(s) - 18, y: py(s) + 6 }, { x: px(s) + 18, y: py(s) + 6 });
    }
    const shrineKinds = rng.shuffle(['blood', 'greed', 'fortune', 'haste']);
    for (let i = 0; i < count(3, 4); i++) {
      const s = take();
      if (!s) break;
      this.markClear(clear, s.tx, s.ty, 2);
      this.pois.push({ type: 'shrine', kind: shrineKinds[i % 4], x: px(s), y: py(s), used: false, radius: 12 });
    }
    for (let i = 0; i < count(3, 5); i++) {
      const s = take();
      if (!s) break;
      this.markClear(clear, s.tx, s.ty, 2);
      this.pois.push({ type: 'mystery', x: px(s), y: py(s), used: false, radius: 11 });
    }
    for (let i = 0; i < count(2, 4); i++) {
      const s = take();
      if (!s) break;
      this.markClear(clear, s.tx, s.ty, 3);
      this.pois.push({ type: 'ambush', x: px(s), y: py(s), triggered: false, radius: 22 });
      // Subtle warning signs: scattered bones.
      for (let k = 0; k < 4; k++) this.decor.push({ kind: 'bones', x: px(s) + rng.range(-20, 20), y: py(s) + rng.range(-16, 16) });
    }
    const chestTarget = count(14, 26);
    while (spots.length > 0 && this.pois.filter((p) => p.type === 'chest').length < chestTarget) {
      const s = take();
      this.markClear(clear, s.tx, s.ty, 1);
      this.pois.push({ type: 'chest', x: px(s), y: py(s), rarity: rng.chance(0.18) ? 'uncommon' : 'common', opened: false, radius: 10 });
    }
  }

  /** Shared final passes: connectivity, props, decor, prop rows. */
  finish(rng, generated) {
    const N = this.n;
    const tiles = this.tiles;
    if (generated) this.ensureConnectivity(this.center.tx, this.center.ty);
    else this.floodReach(this.center.tx, this.center.ty);
    const b = this.biome;

    // Props for y-sorted drawing.
    const treeKinds = Object.keys(b.trees || {});
    for (let ty = 0; ty < N; ty++) {
      for (let tx = 0; tx < N; tx++) {
        const t = tiles[this.idx(tx, ty)];
        const x = tx * TILE + TILE / 2;
        const y = ty * TILE + TILE - 1;
        if ((t === T.TREE && treeKinds.length) || (t === T.BORDER && b.border)) {
          // Only draw border trees that could ever be seen (near the playable area).
          const edge = Math.min(tx, ty, N - 1 - tx, N - 1 - ty);
          if (t === T.BORDER && edge < 1 && rng.chance(0.5)) continue;
          const kind = t === T.BORDER ? b.border : rng.weightedKey(b.trees);
          this.props.push({ kind, variant: rng.int(0, 7), x: x + rng.int(-2, 2), y: y + rng.int(-1, 1) });
        } else if (t === T.PILLAR) {
          this.props.push({ kind: rng.chance(0.65) ? 'pillar' : 'pillarBroken', x, y });
        }
      }
    }

    // Flat decor on open ground.
    if (generated) {
      const decorTiles = b.layout === 'rooms' ? [T.STONE] : [T.GRASS, T.DARK];
      for (let k = 0; k < Math.round(900 * (N / 80) ** 2); k++) {
        const tx = rng.int(3, N - 4);
        const ty = rng.int(3, N - 4);
        if (!decorTiles.includes(tiles[this.idx(tx, ty)])) continue;
        const kind = rng.weightedKey(b.decor);
        this.decor.push({ kind, x: tx * TILE + rng.range(2, 14), y: ty * TILE + rng.range(2, 14), v: rng.int(0, 7) });
      }
      for (const gt of this.pois.filter((p) => p.type === 'gate')) {
        if (b.layout !== 'rooms') this.torches.push({ x: gt.x - 20, y: gt.y + 10 }, { x: gt.x + 20, y: gt.y + 10 });
      }
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
        if (this.landmarkMask[i]) continue;
        if (this.tiles[i] === T.GRASS || this.tiles[i] === T.DARK || this.tiles[i] === T.ICE || this.tiles[i] === T.LAVA) this.tiles[i] = T.DIRT;
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
          if (this.isSolid(x, y) || this.tiles[i] === T.LAVA) this.tiles[i] = this.floorTile;
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
      if (this.isSafeOpen(x, y)) return { x, y };
    }
    return null;
  }

  /** True when no solid tile blocks the straight line between two points. */
  lineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.ceil(d / 6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  inCursedZone(x, y) {
    for (const z of this.cursedZones) if ((x - z.x) ** 2 + (y - z.y) ** 2 < z.r * z.r) return z;
    return null;
  }
}
