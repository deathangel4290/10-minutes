// The director paces the run: spawn pressure per danger phase, elites,
// lazy-spawned camp guards, scheduled merchants, the champion and the
// treasure that appears as the eclipse nears.

import { PHASES, phaseForTimeLeft, RUN_DURATION, SCHEDULE } from '../data/config.js';
import { ENEMIES } from '../data/enemies.js';
import { CURSED_ZONE, MERCHANT_STOCK } from '../data/events.js';
import { Enemy } from './enemies.js';
import { lerp } from '../core/math.js';

export class Director {
  constructor(run) {
    this.run = run;
    this.acc = 0;
    this.recycleT = 0;
    this.merchantsDone = new Set();
    this.championDone = false;
    this.revealsDone = new Set();
    this.gateWarned = new Set();
  }

  spawnAt(type, x, y, opts = {}) {
    const run = this.run;
    const e = new Enemy(run, type, x, y, opts);
    run.enemies.push(e);
    return e;
  }

  spawnNear(type, x, y, minR, maxR, opts = {}) {
    const pt = this.run.map.findOpenPoint(this.run.rng, x, y, minR, maxR);
    if (!pt) return null;
    return this.spawnAt(type, pt.x, pt.y, opts);
  }

  spawnRing() {
    const run = this.run;
    const vr = Math.hypot(run.viewW, run.viewH) / 2;
    // When hunted, enemies appear just outside the screen instead of further out.
    return run.hunted ? [vr * 0.75, vr + 20] : [vr + 10, vr + 60];
  }

  phaseProgress() {
    const run = this.run;
    const p = run.phase;
    const idx = PHASES.indexOf(p);
    const start = idx === 0 ? RUN_DURATION : PHASES[idx - 1].until;
    const end = Math.max(0, p.until);
    return Math.min(1, Math.max(0, (start - run.timeLeft) / (start - end)));
  }

  update(dt) {
    const run = this.run;
    const pl = run.player;

    // Phase changes.
    const phase = phaseForTimeLeft(run.timeLeft);
    if (phase !== run.phase) {
      run.phase = phase;
      run.onPhaseChange(phase);
    }

    // Continuous spawning.
    const p = run.phase;
    const surge = run.timeLeft <= 60; // the last minute floods the field
    const hunted = run.hunted ? 1.5 : 1;
    const rate = lerp(p.spawnRate[0], p.spawnRate[1], this.phaseProgress()) * run.spawnRateMult * (surge ? 1.4 : 1) * hunted;
    const maxAlive = p.maxAlive + (surge ? 20 : 0) + (run.hunted ? 10 : 0);
    const alive = run.enemies.length;
    this.acc += rate * dt;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (alive >= maxAlive) {
        this.acc = Math.min(this.acc, 1);
        break;
      }
      this.spawnWave();
    }

    // Recycle stragglers left far behind so pressure stays around the player.
    this.recycleT -= dt;
    if (this.recycleT <= 0) {
      this.recycleT = 1;
      const [minR, maxR] = this.spawnRing();
      for (const e of run.enemies) {
        if (e.dead || e.guard || e.champion || e.elite) continue;
        if ((e.x - pl.x) ** 2 + (e.y - pl.y) ** 2 > 430 * 430) {
          const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, minR, maxR);
          if (pt) {
            e.x = pt.x;
            e.y = pt.y;
            e.spawnT = 0.35;
          }
        }
      }
    }

    // Lazy camp guards.
    for (const poi of run.pois) {
      if ((poi.type === 'camp' || poi.type === 'treasureGuard') && !poi.spawned) {
        if ((poi.x - pl.x) ** 2 + (poi.y - pl.y) ** 2 < 170 * 170) this.spawnGuards(poi);
      }
    }

    // Scheduled events.
    for (const t of SCHEDULE.merchants) {
      if (run.timeLeft <= t && !this.merchantsDone.has(t)) {
        this.merchantsDone.add(t);
        this.spawnMerchant();
      }
    }
    if (!this.championDone && run.timeLeft <= SCHEDULE.champion) {
      this.championDone = true;
      this.spawnChampion();
    }
    for (const t of SCHEDULE.treasureReveals) {
      if (run.timeLeft <= t && !this.revealsDone.has(t)) {
        this.revealsDone.add(t);
        this.revealTreasure();
      }
    }

    // Gate closures.
    for (const g of run.pois) {
      if (g.type !== 'gate' || !g.open || g.closesAt === null) continue;
      if (run.timeLeft <= g.closesAt + 20 && !this.gateWarned.has(g.id)) {
        this.gateWarned.add(g.id);
        g.closing = true;
        run.hooks.toast('A Rift Gate will collapse in 20s!', 'danger');
        run.hooks.sfx('warning');
      }
      if (run.timeLeft <= g.closesAt) {
        g.open = false;
        g.closing = false;
        run.effects.ring(g.x, g.y - 10, 30, '#7a3fc0', 0.6, 2);
        run.hooks.toast('A Rift Gate has collapsed.', 'danger');
        run.hooks.sfx('gateClose');
      }
    }
  }

  /** The phase's enemy mix, adjusted for the region (and hunters when you camp). */
  currentMix() {
    const run = this.run;
    const mix = { ...run.phase.mix };
    const b = run.biome;
    for (const [k, v] of Object.entries(b.mixAdd || {})) mix[k] = (mix[k] || 0) + v;
    for (const [k, v] of Object.entries(b.mixMult || {})) if (mix[k]) mix[k] *= v;
    if (run.hunted) {
      mix.archer = (mix.archer || 0) + 1.2;
      mix.mage = (mix.mage || 0) + 0.8;
    }
    return mix;
  }

  pickType() {
    return this.run.rng.weightedKey(this.currentMix());
  }

  spawnWave() {
    const run = this.run;
    const pl = run.player;
    const type = this.pickType();
    const [minR, maxR] = this.spawnRing();
    const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, minR, maxR);
    if (!pt) return;
    const cursedZone = run.map.inCursedZone(pt.x, pt.y);
    const eliteChance = run.phase.eliteChance + (cursedZone ? CURSED_ZONE.eliteChanceBonus : 0) + run.eliteChanceBonus + (run.hunted ? 0.04 : 0);
    const def = ENEMIES[type];
    const count = def.packSize ? run.rng.int(def.packSize[0], def.packSize[1]) : 1;
    for (let i = 0; i < count; i++) {
      const elite = i === 0 && run.rng.chance(eliteChance);
      const x = pt.x + (i ? run.rng.range(-10, 10) : 0);
      const y = pt.y + (i ? run.rng.range(-10, 10) : 0);
      if (i && run.map.isSolidAt(x, y)) continue;
      const e = this.spawnAt(type, x, y, { elite, cursed: !!cursedZone });
      if (elite) run.hooks.sfx('eliteSpawn');
      void e;
    }
  }

  spawnGuards(poi) {
    const run = this.run;
    poi.spawned = true;
    const treasure = poi.type === 'treasureGuard';
    const n = treasure ? 6 : run.rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const type = run.rng.weightedKey(treasure ? { skeleton: 3, wolf: 2, archer: 1.5 } : this.currentMix());
      const elite = treasure ? i < 2 : i === 0 && run.rng.chance(0.25 + run.phase.eliteChance);
      this.spawnNear(type, poi.x, poi.y, 6, treasure ? 40 : 34, { elite, guard: true, cursed: !!run.map.inCursedZone(poi.x, poi.y) });
    }
  }

  spawnMerchant() {
    const run = this.run;
    const pl = run.player;
    const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, 70, 120, 30) || run.map.findOpenPoint(run.rng, pl.x, pl.y, 30, 70, 30);
    if (!pt) return;
    const level = run.phase.itemLevel;
    const stock = MERCHANT_STOCK.map((s) => {
      let item = null;
      if (s.kind === 'weapon') item = run.pickups.rollItem({ forceKind: 'weapon', minRarity: s.minRarity, levelBonus: 0 });
      if (s.kind === 'relic') item = run.pickups.rollItem({ forceKind: 'relic', minRarity: s.minRarity });
      const rarityMult = item ? { common: 0.8, uncommon: 1, rare: 1.3, epic: 2, legendary: 3.2 }[item.rarity] : 1;
      return { ...s, item, price: Math.round((s.basePrice * (1 + (level - 1) * 0.45) * rarityMult) / 5) * 5, sold: false };
    });
    run.pois.push({ type: 'merchant', x: pt.x, y: pt.y, radius: 13, stock, expiresAt: run.timeLeft - 80, discovered: true });
    run.hooks.toast('A Wandering Merchant has appeared nearby!', 'gold');
    run.hooks.sfx('merchant');
  }

  spawnChampion() {
    const run = this.run;
    const pl = run.player;
    const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, 150, 240, 40) || run.map.findOpenPoint(run.rng, pl.x, pl.y, 90, 150, 40);
    if (!pt) return;
    const e = this.spawnAt('champion', pt.x, pt.y, { elite: true, guard: true });
    run.championRef = e;
    run.hooks.banner('THE BONE COLOSSUS RISES', 'Slay it for legendary treasure... or run.', 'danger');
    run.hooks.sfx('champion');
  }

  revealTreasure() {
    const run = this.run;
    const pl = run.player;
    let placed = 0;
    for (let i = 0; i < 2; i++) {
      const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, 140, 380, 40);
      if (!pt) continue;
      const lvl = run.phase.itemLevel;
      const rarity = lvl >= 4 ? (run.rng.chance(0.35) ? 'epic' : 'rare') : lvl >= 3 ? 'rare' : run.rng.chance(0.4) ? 'rare' : 'uncommon';
      run.pois.push({ type: 'chest', x: pt.x, y: pt.y, rarity, opened: false, radius: 10, discovered: true, revealed: true });
      placed++;
    }
    if (placed) run.hooks.toast(`The eclipse reveals ${placed} hidden chests (see map)`, 'purple');
  }
}
