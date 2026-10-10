// The walkable town hub. It reuses the map, player and renderer from a run,
// but has no clock and no enemies: you walk up to vendors to shop and step
// into the Rift Portal to choose a region.

import { TILE } from '../data/config.js';
import { TOWN_BIOME, VENDORS } from '../data/town.js';
import { GameMap, T } from './map.js';
import { Player } from './player.js';
import { Effects } from './effects.js';
import { starterWeapon } from './items.js';
import { metaMods } from '../data/meta.js';
import { NOOP_HOOKS } from './run.js';

const HOUSE_W = 5;
const HOUSE_H = 3;

/**
 * Lay out Emberfall as a narrow street that fits a portrait screen: the Rift
 * Portal at the top, two shops on each side of the road, a plaza with a
 * campfire in the middle, and you arrive from the south.
 */
export function buildTown(map, rng) {
  const N = map.n;
  const set = (x, y, t) => {
    if (map.inBounds(x, y)) map.tiles[map.idx(x, y)] = t;
  };
  const rect = (x0, y0, w, h, t) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t);
  };
  rect(0, 0, N, N, T.GRASS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.min(x, y, N - 1 - x, N - 1 - y) < 2) set(x, y, T.BORDER);

  rect(13, 2, 8, 5, T.STONE); // portal dais
  rect(16, 6, 2, N - 8, T.COBBLE); // main road
  rect(10, 11, 14, 2, T.COBBLE); // upper shop fronts
  rect(11, 14, 12, 5, T.COBBLE); // plaza
  rect(10, 23, 14, 2, T.COBBLE); // lower shop fronts

  const houses = [
    { vendor: 'smith', x: 10, y: 8 },
    { vendor: 'mystic', x: 19, y: 8 },
    { vendor: 'alchemist', x: 10, y: 20 },
    { vendor: 'trader', x: 19, y: 20 },
  ];
  for (const h of houses) {
    rect(h.x, h.y, HOUSE_W, HOUSE_H, T.WALL);
    const v = VENDORS.find((vv) => vv.id === h.vendor);
    const left = h.x < 16;
    // The house sprite is drawn as a y-sorted prop anchored at the footprint's bottom edge.
    map.props.push({ kind: `house_${h.vendor}`, x: (h.x + HOUSE_W / 2) * TILE, y: (h.y + HOUSE_H) * TILE - 1 });
    // Shopkeepers stand by their door, on the road side.
    const vx = left ? (h.x + HOUSE_W) * TILE - 6 : h.x * TILE + 6;
    map.pois.push({ type: 'vendor', shop: h.vendor, label: v.label, color: v.color, x: vx, y: (h.y + HOUSE_H) * TILE + 14, radius: 13, discovered: true });
    map.torches.push({ x: left ? h.x * TILE + 6 : (h.x + HOUSE_W) * TILE - 6, y: (h.y + HOUSE_H) * TILE + 8 });
  }

  // Dense woods outside the street, a few trees along it.
  for (let y = 2; y < N - 2; y++) {
    for (let x = 2; x < N - 2; x++) {
      if (map.tile(x, y) !== T.GRASS) continue;
      const outside = x < 9 || x > 24 || y > 30;
      if ((outside && rng.chance(0.7)) || (!outside && rng.chance(0.05) && Math.abs(x - 16.5) > 3)) set(x, y, T.TREE);
    }
  }

  map.center = { tx: 16, ty: 29 };
  map.spawn = { x: 17 * TILE, y: 29 * TILE + 8 };
  map.pois.push({ type: 'portal', x: 17 * TILE, y: 5 * TILE + 4, radius: 16, open: true, discovered: true });
  map.pois.push({ type: 'camp', x: 17 * TILE, y: 16 * TILE + 8, radius: 0, discovered: true });
  map.pois.push({ type: 'board', label: 'RECORDS', color: '#c9c6dc', x: 13 * TILE, y: 17 * TILE, radius: 11, discovered: true });
  map.torches.push({ x: 14 * TILE, y: 6 * TILE + 4 }, { x: 20 * TILE, y: 6 * TILE + 4 });
  map.torches.push({ x: 15 * TILE, y: 27 * TILE }, { x: 19 * TILE, y: 27 * TILE });

  for (let k = 0; k < 260; k++) {
    const x = rng.int(3, N - 4);
    const y = rng.int(3, N - 4);
    if (map.tile(x, y) !== T.GRASS) continue;
    map.decor.push({ kind: rng.weightedKey(TOWN_BIOME.decor), x: x * TILE + rng.range(2, 14), y: y * TILE + rng.range(2, 14), v: rng.int(0, 7) });
  }
}

export class Town {
  static metaFor(meta) {
    return metaMods(meta);
  }

  constructor({ meta = {}, hooks = {}, viewW = 176, viewH = 380 }) {
    this.biome = TOWN_BIOME;
    this.map = new GameMap(4242, TOWN_BIOME, { custom: buildTown, size: TOWN_BIOME.size });
    this.hooks = { ...NOOP_HOOKS, ...hooks };
    this.viewW = viewW;
    this.viewH = viewH;
    this.timeLeft = 600;
    this.time = 0;
    this.phase = { id: 0, darkness: 0.2, healMult: 1, itemLevel: 1, name: '' };
    this.enemies = [];
    this.pickups = { list: [] };
    this.combat = { projectiles: [], enemyProjectiles: [], runes: [], nearestEnemy: () => null, hitEnemy: () => null, shockwave: () => {}, spawnShadowWave: () => {} };
    this.effects = new Effects();
    this.pois = this.map.pois;
    this.explored = new Uint8Array(this.map.n * this.map.n).fill(1);
    this.championRef = null;
    this.ended = false;
    this.modal = null;
    this.stats = { kills: 0 };
    this.playerDamageTakenMult = 1;
    this.player = new Player(this, { weapon: starterWeapon(), metaMods: metaMods(meta) });
  }

  get elapsed() {
    return 0;
  }

  update(dt, input) {
    if (this.modal) return;
    this.time += dt;
    this.player.update(dt, { ...input, attack: false, nova: false, potion: false, autoAttack: false });
    this.effects.update(dt);
    const p = this.player;
    for (const poi of this.pois) {
      if (poi.radius <= 0) continue;
      const inside = (poi.x - p.x) ** 2 + (poi.y - p.y) ** 2 < (poi.radius + p.radius) ** 2;
      if (!inside) {
        poi.blocked = false;
        continue;
      }
      if (poi.blocked) continue;
      poi.blocked = true;
      if (poi.type === 'vendor') this.openModal({ kind: 'vendor', vendor: poi.shop, poi });
      else if (poi.type === 'portal') this.openModal({ kind: 'portal', poi });
      else if (poi.type === 'board') this.openModal({ kind: 'board', poi });
      if (this.modal) break;
    }
  }

  openModal(payload) {
    this.modal = payload;
    this.hooks.sfx('door');
    this.hooks.openModal(payload);
  }

  closeModal() {
    this.modal = null;
    this.hooks.closeModal();
  }
}
