// Things on the ground: gold, soul shards (XP), items, potions.
// Gold and XP are magnetized; items need to be walked over.

import { rollRarity, bumpRarity, RARITY_INFO } from '../data/rarities.js';
import { makeWeapon, makeRelic, makePotion } from './items.js';

const MAX_SHARDS = 160;

export class Pickups {
  constructor(run) {
    this.run = run;
    this.list = [];
  }

  spawn(kind, x, y, extra = {}) {
    const rng = this.run.rng;
    const a = rng.range(0, Math.PI * 2);
    const sp = extra.burst ?? rng.range(15, 45);
    const p = {
      kind,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.6,
      z: 2,
      vz: rng.range(45, 75),
      age: 0,
      magnet: false,
      ...extra,
    };
    this.list.push(p);
    return p;
  }

  dropXp(x, y, amount) {
    let shards = 0;
    for (const p of this.list) if (p.kind === 'xp') shards++;
    if (shards >= MAX_SHARDS) {
      // Merge into an existing shard instead of flooding the ground.
      for (const p of this.list) {
        if (p.kind === 'xp') {
          p.value += amount;
          p.big = true;
          return;
        }
      }
    }
    this.spawn('xp', x, y, { value: amount, big: amount >= 12 });
  }

  dropGold(x, y, amount) {
    const coins = Math.min(5, Math.max(1, Math.ceil(amount / 6)));
    const per = amount / coins;
    for (let i = 0; i < coins; i++) this.spawn('gold', x, y, { value: per });
  }

  dropPotion(x, y) {
    this.spawn('item', x, y, { item: makePotion(), burst: 20 });
  }

  /** Roll an item using the current phase's loot quality. */
  rollItem({ bump = 0, levelBonus = 0, minRarity = 'common', forceKind = null } = {}) {
    const run = this.run;
    const level = run.phase.itemLevel + levelBonus;
    let rarity = rollRarity(run.rng, level, run.player.stats.raw.luck, minRarity);
    if (bump) rarity = bumpRarity(rarity, bump);
    const kind = forceKind || (run.rng.chance(0.58) ? 'weapon' : 'relic');
    if (kind === 'relic') {
      const relic = makeRelic(run.rng, rarity, run.player.relics.map((r) => r.id));
      if (relic) return relic;
    }
    return makeWeapon(run.rng, { rarity, itemLevel: level, types: run.weaponTypes });
  }

  dropRandomItem(x, y, opts = {}) {
    const item = this.rollItem(opts);
    this.dropItem(x, y, item);
    return item;
  }

  dropItem(x, y, item, burst = 30) {
    const p = this.spawn('item', x, y, { item, burst });
    if (RARITY_INFO[item.rarity].tier >= 3) {
      const color = item.rarity === 'legendary' ? 'orange' : 'purple';
      this.run.effects.beam(x, y, color, 3.5);
      this.run.hooks.sfx(item.rarity === 'legendary' ? 'legendaryDrop' : 'epicDrop');
      if (item.rarity === 'legendary') {
        this.run.hooks.banner('LEGENDARY!', item.name, 'legendary');
        this.run.hooks.haptic([40, 60, 80]);
        this.run.hooks.shake(6);
      }
    }
    return p;
  }

  /** Drop a chest on the ground (champion reward, ambush reward). */
  dropChest(x, y, rarity, extra = {}) {
    const run = this.run;
    run.pois.push({ type: 'chest', x, y, rarity, opened: false, radius: 10, discovered: true, dropped: true, ...extra });
    run.effects.burst(x, y - 6, ['#ffd36b', '#f4f2ff'], 16, 60, 0.6, 20);
    run.effects.beam(x, y, rarity === 'legendary' ? 'orange' : 'purple', 2.5);
  }

  update(dt) {
    const run = this.run;
    const pl = run.player;
    const pickR = pl.stats.pickupRadius;
    let w = 0;
    for (const p of this.list) {
      p.age += dt;
      // Bounce in.
      if (p.z > 0 || p.vz > 0) {
        p.vz -= 260 * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          p.vz = p.vz < -30 ? -p.vz * 0.35 : 0;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const d = Math.exp(-3 * dt);
        p.vx *= d;
        p.vy *= d;
        if (run.map.isSolidAt(p.x, p.y)) {
          p.x -= p.vx * dt * 2;
          p.y -= p.vy * dt * 2;
          p.vx = p.vy = 0;
        }
      }
      const dx = pl.x - p.x;
      const dy = pl.y - 4 - p.y;
      const d2 = dx * dx + dy * dy;
      if (p.kind === 'item') {
        if (p.age > 0.45 && d2 < 12 * 12 && !pl.dead) {
          if (run.collectItem(p.item)) continue;
          p.age = -1.2; // couldn't take it (full potions) — wait before retrying
        }
      } else {
        if (!p.magnet && p.age > 0.25 && d2 < pickR * pickR) p.magnet = true;
        if (p.magnet && !pl.dead) {
          const d = Math.sqrt(d2) || 1;
          const sp = 90 + p.age * 160;
          p.x += (dx / d) * sp * dt;
          p.y += (dy / d) * sp * dt;
          if (d < 6) {
            if (p.kind === 'gold') run.collectGold(p.value);
            else run.collectXp(p.value);
            continue;
          }
        }
      }
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  /** Vacuum every gold/XP pickup (used at the end of a successful escape). */
  collectAll() {
    for (const p of this.list) {
      if (p.kind === 'gold') this.run.collectGold(p.value, true);
      else if (p.kind === 'xp') this.run.collectXp(p.value);
    }
    this.list = this.list.filter((p) => p.kind === 'item');
  }
}
