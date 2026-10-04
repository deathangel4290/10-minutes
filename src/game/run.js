// One 10-minute run. Owns the world and every gameplay system, and talks to
// the outside (UI, audio, haptics) only through `hooks`, so it can also run
// headless in tests and balance simulations.

import { RUN_DURATION, PHASES, MAP_TILES, TILE } from '../data/config.js';
import { RNG } from '../core/rng.js';
import { GameMap } from './map.js';
import { Player } from './player.js';
import { updateEnemy } from './enemies.js';
import { Combat } from './combat.js';
import { Pickups } from './pickups.js';
import { Director } from './director.js';
import { Events } from './events.js';
import { Effects } from './effects.js';
import { rollUpgradeChoices } from './upgrades.js';
import { starterWeapon } from './items.js';
import { metaMods } from '../data/meta.js';
import { weaponDps } from './stats.js';
import { computeEmbers, computeScore } from './score.js';
import { RARITY_INFO } from '../data/rarities.js';
import { formatTime } from '../core/math.js';

const NOOP = () => {};
export const NOOP_HOOKS = {
  sfx: NOOP,
  haptic: NOOP,
  shake: NOOP,
  hitstop: NOOP,
  toast: NOOP,
  banner: NOOP,
  openModal: NOOP,
  closeModal: NOOP,
  itemPickup: NOOP,
  damageFlash: NOOP,
  phase: NOOP,
  end: NOOP,
};

const GRID_CELL = 24;

export class Run {
  /**
   * @param {{seed:number, meta:object, unlocks:object, hooks?:object, viewW?:number, viewH?:number}} opts
   */
  constructor({ seed, meta = {}, unlocks = {}, hooks = {}, viewW = 176, viewH = 380 }) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed ^ 0x5bd1e995);
    this.map = new GameMap(this.seed);
    this.hooks = { ...NOOP_HOOKS, ...hooks };
    this.viewW = viewW;
    this.viewH = viewH;
    this.timeLeft = RUN_DURATION;
    this.time = 0;
    this.phase = PHASES[0];
    this.unlocks = unlocks;
    this.weaponTypes = ['sword', ...(unlocks.dagger ? ['dagger'] : []), ...(unlocks.axe ? ['axe'] : [])];
    this.rerolls = meta.reroll || 0;

    this.enemies = [];
    this.pois = this.map.pois.map((p) => ({ ...p, discovered: p.type === 'gate' }));
    this.explored = new Uint8Array(MAP_TILES * MAP_TILES);
    this.effects = new Effects();
    this.combat = new Combat(this);
    this.pickups = new Pickups(this);
    this.director = new Director(this);
    this.events = new Events(this);

    this.gold = 0;
    this.bag = [];
    this.stats = { kills: 0, elites: 0, champions: 0, goldFound: 0, goldSpent: 0, damageDealt: 0, damageTaken: 0, chests: 0, itemsFound: 0, bestItem: null };
    this.playerDamageTakenMult = 1;
    this.spawnRateMult = 1;
    this.eliteChanceBonus = 0;
    this.championRef = null;
    this.pendingAmbush = null;

    this.player = new Player(this, { weapon: starterWeapon(), metaMods: metaMods(meta) });
    this.modal = null;
    this.ended = false;
    this.result = null;
    this.flowT = 0;
    this.exploreT = 0;
    this.grid = new Map();
    this.coinSfxT = 0;
    this.xpSfxT = 0;
    this.xpCombo = 0;
  }

  get elapsed() {
    return RUN_DURATION - this.timeLeft;
  }

  // ── Main update ───────────────────────────────────────────
  update(dt, input) {
    if (this.ended) {
      this.effects.update(dt);
      return;
    }
    if (this.modal) return;
    if (this.player.pendingLevels > 0) {
      this.openLevelUp();
      return;
    }
    if (this.pendingAmbush) {
      const poi = this.pendingAmbush;
      this.pendingAmbush = null;
      this.events.triggerAmbush(poi);
    }

    this.time += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.player.dead = true;
      this.end('died', { cause: 'eclipse' });
      return;
    }
    this.coinSfxT -= dt;
    this.xpSfxT -= dt;

    this.director.update(dt);

    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.2;
      this.map.computeFlow(this.player.x, this.player.y);
    }

    this.player.update(dt, input);
    this.updateEnemies(dt);
    this.combat.update(dt);
    this.pickups.update(dt);
    this.events.update(dt);
    this.effects.update(dt);

    this.exploreT -= dt;
    if (this.exploreT <= 0) {
      this.exploreT = 0.25;
      this.reveal();
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    const grid = this.grid;
    for (const arr of grid.values()) arr.length = 0;
    const cols = Math.ceil(this.map.size / GRID_CELL);
    for (const e of this.enemies) {
      if (e.dead) continue;
      updateEnemy(this, e, dt);
      this.combat.updateStatus(e, dt);
      const key = Math.floor(e.y / GRID_CELL) * cols + Math.floor(e.x / GRID_CELL);
      let cell = grid.get(key);
      if (!cell) grid.set(key, (cell = []));
      cell.push(e);
    }
    // Soft separation so crowds spread out instead of stacking.
    for (const e of this.enemies) {
      if (e.dead) continue;
      const gx = Math.floor(e.x / GRID_CELL);
      const gy = Math.floor(e.y / GRID_CELL);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cell = grid.get((gy + oy) * cols + gx + ox);
          if (!cell) continue;
          for (const o of cell) {
            if (o.id <= e.id || o.dead) continue;
            const dx = o.x - e.x;
            const dy = o.y - e.y;
            const min = e.radius + o.radius;
            const d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 < 1e-6) continue;
            const d = Math.sqrt(d2);
            const push = (min - d) * 0.5;
            const nx = dx / d;
            const ny = dy / d;
            const we = e.champion ? 0.1 : o.champion ? 1.9 : 1;
            e.x -= nx * push * we;
            e.y -= ny * push * we;
            o.x += nx * push * (2 - we);
            o.y += ny * push * (2 - we);
          }
        }
      }
      // Don't overlap the player (the player is never pushed; control stays crisp).
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const min = e.radius + p.radius - 1;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-6 && e.state !== 'lunge') {
        const d = Math.sqrt(d2);
        e.x = p.x + (dx / d) * min;
        e.y = p.y + (dy / d) * min;
      }
      this.map.collide(e, e.prevX, e.prevY);
    }
    // Remove the dead.
    let w = 0;
    for (const e of this.enemies) if (!e.dead) this.enemies[w++] = e;
    this.enemies.length = w;
    if (this.championRef && this.championRef.dead) this.championRef = null;
  }

  reveal() {
    const N = MAP_TILES;
    const tx = Math.floor(this.player.x / TILE);
    const ty = Math.floor(this.player.y / TILE);
    const r = 7;
    for (let y = ty - r; y <= ty + r; y++)
      for (let x = tx - r; x <= tx + r; x++)
        if (x >= 0 && y >= 0 && x < N && y < N && (x - tx) ** 2 + (y - ty) ** 2 <= r * r) this.explored[y * N + x] = 1;
  }

  // ── Leveling ──────────────────────────────────────────────
  openLevelUp() {
    const p = this.player;
    const choices = rollUpgradeChoices(this.rng, p.upgrades, this.unlocks, 3);
    this.hooks.sfx('levelUp');
    this.openModal({ kind: 'levelup', choices, level: p.level - p.pendingLevels + 1, rerolls: this.rerolls });
  }

  chooseUpgrade(index) {
    if (!this.modal || this.modal.kind !== 'levelup') return;
    const choice = this.modal.choices[index];
    if (!choice) return;
    const p = this.player;
    const u = choice.upgrade;
    p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
    if (u.onPick) {
      if (u.onPick.healPct) p.heal(p.stats.maxHp * u.onPick.healPct);
      if (u.onPick.gold) this.collectGold(u.onPick.gold, true);
    }
    p.recompute();
    p.pendingLevels--;
    this.effects.ring(p.x, p.y - 6, 30, '#ffd36b', 0.45, 2);
    this.effects.burst(p.x, p.y - 6, ['#ffd36b', '#f4f2ff', '#ff9a3c'], 16, 70, 0.6, -20);
    p.iframes = Math.max(p.iframes, 0.6); // grace after unpausing
    this.hooks.sfx('select');
    this.closeModal();
  }

  rerollUpgrades() {
    if (!this.modal || this.modal.kind !== 'levelup' || this.rerolls <= 0) return;
    this.rerolls--;
    this.modal.choices = rollUpgradeChoices(this.rng, this.player.upgrades, this.unlocks, 3);
    this.modal.rerolls = this.rerolls;
    this.hooks.openModal(this.modal);
  }

  // ── Modals ────────────────────────────────────────────────
  openModal(payload) {
    this.modal = payload;
    this.hooks.openModal(payload);
  }

  closeModal() {
    this.modal = null;
    this.hooks.closeModal();
  }

  /** A choice in an event modal. */
  resolveEvent(action) {
    if (!this.modal) return;
    const result = this.events.resolve(action, this.modal);
    if (result) {
      this.modal = { ...this.modal, result };
      this.hooks.openModal(this.modal);
    } else {
      this.closeModal();
    }
  }

  buyFromMerchant(index) {
    if (!this.modal || this.modal.kind !== 'merchant') return false;
    const ok = this.events.buy(this.modal.poi, index);
    this.hooks.openModal(this.modal);
    return ok;
  }

  escape() {
    if (this.ended) return;
    this.modal = null;
    this.hooks.closeModal();
    this.pickups.collectAll();
    this.end('escaped', { cause: null });
  }

  abandon() {
    if (this.ended) return;
    this.modal = null;
    this.player.dead = true;
    this.end('died', { cause: 'abandon' });
  }

  // ── Collection ────────────────────────────────────────────
  collectGold(value, silent = false) {
    const amount = value * (1 + this.player.stats.raw.goldPct);
    this.gold += amount;
    this.stats.goldFound += amount;
    if (!silent && this.coinSfxT <= 0) {
      this.coinSfxT = 0.06;
      this.hooks.sfx('coin');
    }
  }

  collectXp(value) {
    this.player.addXp(value);
    if (this.xpSfxT <= 0) {
      this.xpSfxT = 0.05;
      this.hooks.sfx('xp');
    }
  }

  /** @returns {boolean} false if the item can't be taken right now */
  collectItem(item, opts = {}) {
    const p = this.player;
    if (item.kind === 'potion') {
      if (p.potions >= p.stats.potionCapacity) {
        if (!opts.bought) this.hooks.toast('Potion belt full', 'muted');
        return false;
      }
      p.potions++;
      this.hooks.sfx('pickup');
      this.hooks.itemPickup(item, null);
      return true;
    }
    this.stats.itemsFound++;
    if (!this.stats.bestItem || RARITY_INFO[item.rarity].tier > RARITY_INFO[this.stats.bestItem.rarity].tier) this.stats.bestItem = item;
    if (item.kind === 'relic') {
      p.relics.push(item);
      p.recompute();
      this.hooks.sfx(RARITY_INFO[item.rarity].tier >= 3 ? 'pickupRare' : 'pickup');
      this.hooks.itemPickup(item, null);
      return true;
    }
    // Weapon: goes to the bag; the UI offers to equip it.
    this.bag.push(item);
    const compare = this.compareWeapon(item);
    if (p.weapon.starter) {
      this.equipWeapon(item.uid, true);
      compare.autoEquipped = true;
    }
    this.hooks.sfx(RARITY_INFO[item.rarity].tier >= 3 ? 'pickupRare' : 'pickup');
    this.hooks.itemPickup(item, compare);
    return true;
  }

  compareWeapon(item) {
    const p = this.player;
    const s = p.stats;
    const cur = weaponDps(p.weapon, s.critChance - (p.weapon.critBonus || 0), s.critDamage);
    const next = weaponDps(item, s.critChance - (p.weapon.critBonus || 0), s.critDamage);
    return { current: p.weapon, dpsDelta: cur > 0 ? next / cur - 1 : 0 };
  }

  equipWeapon(uid, silent = false) {
    const p = this.player;
    const idx = this.bag.findIndex((it) => it.uid === uid);
    if (idx < 0) return false;
    const item = this.bag[idx];
    this.bag.splice(idx, 1);
    if (!p.weapon.starter) this.bag.push(p.weapon);
    p.weapon = item;
    p.recompute();
    if (!silent) this.hooks.sfx('equip');
    return true;
  }

  /** Everything the player would keep by escaping now. */
  haul() {
    const items = [...this.bag, ...this.player.relics];
    if (!this.player.weapon.starter) items.push(this.player.weapon);
    return items;
  }

  estimateEmbers() {
    return computeEmbers({ outcome: 'escaped', gold: this.gold, kills: this.stats.kills, elites: this.stats.elites, champions: this.stats.champions, elapsed: this.elapsed, items: this.haul() }).total;
  }

  // ── Phase / death / end ───────────────────────────────────
  onPhaseChange(phase) {
    this.player.recompute(); // conditional relics (e.g. final 2 minutes)
    if (phase.banner) this.hooks.banner(phase.banner.title, phase.banner.sub, phase.id >= 3 ? 'danger' : 'purple');
    this.hooks.phase(phase);
    this.hooks.sfx('phase');
  }

  onPlayerDeath(source) {
    const p = this.player;
    let near = 0;
    for (const e of this.enemies) if (!e.dead && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 60 * 60) near++;
    this.end('died', { cause: 'enemy', killer: source, near });
  }

  end(outcome, info = {}) {
    if (this.ended) return;
    this.ended = true;
    const items = this.haul();
    const elapsed = this.elapsed;
    const common = { outcome, gold: this.gold, goldFound: this.stats.goldFound, kills: this.stats.kills, elites: this.stats.elites, champions: this.stats.champions, elapsed, items };
    const embers = computeEmbers(common);
    const score = computeScore(common);

    let causeTitle = null;
    let causeDetail = null;
    if (outcome === 'died') {
      if (info.cause === 'eclipse') {
        causeTitle = 'Consumed by the Eclipse';
        causeDetail = 'The clock hit 0:00 before you reached a Rift Gate.';
      } else if (info.cause === 'abandon') {
        causeTitle = 'Run abandoned';
        causeDetail = 'You turned back. The dark keeps what you carried.';
      } else {
        const k = info.killer;
        const name = k ? `${k.elite && !k.champion ? 'Elite ' : ''}${k.def.name}` : 'the dark';
        causeTitle = `Slain by ${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`;
        causeDetail = info.near >= 5 ? `You were overwhelmed by ${info.near} enemies.` : info.near >= 2 ? `${info.near} enemies had you cornered.` : 'It caught you alone.';
      }
    }

    this.result = {
      outcome,
      seed: this.seed,
      causeTitle,
      causeDetail,
      elapsed,
      timeLeft: this.timeLeft,
      survivalText: formatTime(elapsed),
      kills: this.stats.kills,
      elites: this.stats.elites,
      champions: this.stats.champions,
      chests: this.stats.chests,
      goldFound: Math.round(this.stats.goldFound),
      goldHeld: Math.round(this.gold),
      xpEarned: Math.round(this.player.totalXp),
      level: this.player.level,
      items,
      bestItem: this.stats.bestItem,
      score,
      embers,
      build: Object.entries(this.player.upgrades).sort((a, b) => b[1] - a[1]),
      weapon: this.player.weapon,
    };
    this.hooks.end(this.result);
  }
}
