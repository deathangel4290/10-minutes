// The player: movement, swing, dash, Nova, potions, taking damage, leveling.

import { PLAYER_BASE, RUN_DURATION } from '../data/config.js';
import { computePlayerStats } from './stats.js';
import { upgradeMods, UPGRADE_BY_ID } from '../data/upgrades.js';
import { xpForLevel } from './upgrades.js';
import { angleDiff } from '../core/math.js';

export class Player {
  constructor(run, { weapon, metaMods, potionBonus = 0 }) {
    this.run = run;
    this.x = run.map.spawn.x;
    this.y = run.map.spawn.y;
    this.radius = 5;
    this.facing = 1;
    this.aimAngle = 0;
    this.moveAngle = 0;
    this.moving = false;
    this.animT = 0;

    this.weapon = weapon;
    this.gear = { helm: null, chest: null, boots: null };
    this.relics = [];
    this.upgrades = {};
    this.buffs = []; // shrine boons/banes: { id, mods }
    this.metaMods = metaMods;

    this.level = 1;
    this.xp = 0;
    this.xpToNext = xpForLevel(1);
    this.pendingLevels = 0;
    this.totalXp = 0;

    this.attackCd = 0;
    this.swingT = 0;
    this.swingDir = 1;
    this.attackCount = 0;
    this.dashCd = 0;
    this.dashT = 0;
    this.dashVx = 0;
    this.dashVy = 0;
    this.dashHits = new Set();
    this.iframes = 0;
    this.shield = 0;
    this.shieldT = 0;
    this.hurtFlash = 0;
    this.regenPause = 0;
    this.lifestealBudget = 0;
    this.slowMult = 1;
    this.orbitAngle = 0;
    this.dead = false;
    this.lastHitBy = null;

    this.recompute();
    this.hp = this.stats.maxHp;
    this.energy = 0;
    this.potions = Math.min(this.stats.potionCapacity, PLAYER_BASE.startingPotions + potionBonus);
    this.revivesLeft = this.stats.raw.revive;
  }

  allModLists() {
    const lists = [this.metaMods, this.weapon.mods];
    for (const g of Object.values(this.gear)) if (g) lists.push(g.mods);
    for (const [id, rank] of Object.entries(this.upgrades)) {
      const u = UPGRADE_BY_ID[id];
      if (u) lists.push(upgradeMods(u, rank));
    }
    const final2 = this.run.timeLeft <= 120;
    for (const r of this.relics) if (!r.when || (r.when === 'final2' && final2)) lists.push(r.mods);
    for (const b of this.buffs) lists.push(b.mods);
    return lists;
  }

  recompute() {
    const prevMax = this.stats ? this.stats.maxHp : null;
    this.stats = computePlayerStats(this.weapon, this.allModLists());
    if (prevMax !== null && this.stats.maxHp !== prevMax) {
      // Keep the same HP fraction when max HP changes (gains feel good, losses are fair).
      const diff = this.stats.maxHp - prevMax;
      this.hp = Math.max(1, Math.min(this.stats.maxHp, this.hp + Math.max(0, diff)));
    }
    if (this.potions > this.stats.potionCapacity) this.potions = this.stats.potionCapacity;
  }

  get dashing() {
    return this.dashT > 0;
  }

  /**
   * Restore HP. Passive healing (regen, lifesteal, on-kill) weakens as the
   * eclipse nears; potions and blessings (`raw`) always heal in full.
   */
  heal(amount, raw = false) {
    if (amount <= 0 || this.dead) return 0;
    if (!raw) amount *= this.run.phase.healMult ?? 1;
    const before = this.hp;
    this.hp = Math.min(this.stats.maxHp, this.hp + amount);
    return this.hp - before;
  }

  /** Lifesteal draws from a budget that refills each second, so it can't outheal a crowd. */
  lifestealHeal(amount) {
    const take = Math.min(amount, this.lifestealBudget);
    if (take <= 0) return 0;
    this.lifestealBudget -= take;
    return this.heal(take);
  }

  addXp(amount) {
    const gained = amount * (1 + this.stats.raw.xpPct);
    this.xp += gained;
    this.totalXp += gained;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.pendingLevels++;
    }
  }

  update(dt, input) {
    const run = this.run;
    const s = this.stats;
    this.animT += dt;
    this.attackCd -= dt;
    this.dashCd -= dt;
    this.iframes -= dt;
    this.hurtFlash -= dt;
    this.swingT -= dt;
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.shield = 0;
    }

    // Regeneration pauses briefly after every hit, so tanking a crowd doesn't out-heal it.
    this.regenPause -= dt;
    if (s.regen > 0 && this.regenPause <= 0) this.heal(s.regen * dt);
    const lsCap = s.maxHp * 0.03 + 2;
    this.lifestealBudget = Math.min(lsCap, this.lifestealBudget + lsCap * dt);

    // Movement.
    const mx = input.moveX;
    const my = input.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    this.moving = mag > 0.12;
    if (this.moving) {
      this.moveAngle = Math.atan2(my, mx);
      if (this.swingT <= 0) this.facing = mx >= 0 ? 1 : -1;
    }

    if (input.dash && this.dashCd <= 0 && !this.dead) this.startDash();

    const prevX = this.x;
    const prevY = this.y;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.x += this.dashVx * dt;
      this.y += this.dashVy * dt;
      if (Math.random() < 0.6) run.effects.afterimage(this.x, this.y, this.currentSpriteName(), this.facing < 0);
      if (s.raw.dashStrike > 0) {
        for (const e of run.enemies) {
          if (e.dead || this.dashHits.has(e.id)) continue;
          if ((e.x - this.x) ** 2 + (e.y - this.y) ** 2 < (e.radius + this.radius + 4) ** 2) {
            this.dashHits.add(e.id);
            run.combat.hitEnemy(e, s.damage * s.raw.dashStrike, { source: 'dash', kx: this.dashVx, ky: this.dashVy, knock: 90 });
          }
        }
      }
    } else if (this.moving) {
      const speed = s.moveSpeed * mag * this.slowMult;
      this.x += Math.cos(this.moveAngle) * speed * dt;
      this.y += Math.sin(this.moveAngle) * speed * dt;
    }
    run.map.collide(this, prevX, prevY);

    // Attacking: hold to swing, auto-aim at the nearest enemy in reach.
    const wantAttack = input.attack || (input.autoAttack && run.combat.nearestEnemy(this.x, this.y, s.range + 14));
    if (wantAttack && this.attackCd <= 0 && this.dashT <= 0) this.swing();

    if (input.nova) this.nova();
    if (input.potion) this.drinkPotion();

    // Orbiting spectral blades.
    if (s.raw.orbitBlades > 0) {
      this.orbitAngle += dt * 3.4;
      const n = s.raw.orbitBlades;
      const r = 22 * (1 + s.raw.areaPct * 0.4);
      for (let i = 0; i < n; i++) {
        const a = this.orbitAngle + (i * Math.PI * 2) / n;
        const bx = this.x + Math.cos(a) * r;
        const by = this.y - 4 + Math.sin(a) * r;
        for (const e of run.enemies) {
          if (e.dead || e.orbitCd > 0) continue;
          if ((e.x - bx) ** 2 + (e.y - 4 - by) ** 2 < (e.radius + 5) ** 2) {
            e.orbitCd = 0.45;
            run.combat.hitEnemy(e, s.damage * 0.55, { source: 'orbit', kx: Math.cos(a), ky: Math.sin(a), knock: 40 });
          }
        }
      }
    }
  }

  currentSpriteName() {
    if (!this.moving || this.dashT > 0) return 'player_idle';
    return Math.floor(this.animT * 8) % 2 === 0 ? 'player_runA' : 'player_runB';
  }

  startDash() {
    const run = this.run;
    const s = this.stats;
    const angle = this.moving ? this.moveAngle : this.facing > 0 ? 0 : Math.PI;
    this.dashVx = Math.cos(angle) * PLAYER_BASE.dashSpeed;
    this.dashVy = Math.sin(angle) * PLAYER_BASE.dashSpeed;
    this.dashT = PLAYER_BASE.dashTime;
    this.dashCd = s.dashCooldown;
    this.iframes = Math.max(this.iframes, PLAYER_BASE.dashTime + 0.08);
    this.dashHits.clear();
    if (s.raw.dashShield > 0) {
      this.shield = s.raw.dashShield;
      this.shieldT = 2.2;
    }
    run.hooks.sfx('dash');
    run.effects.burst(this.x, this.y, ['#4a4560', '#8a84a6'], 6, 40, 0.3, 0);
  }

  swing() {
    const run = this.run;
    const s = this.stats;
    const target = run.combat.nearestEnemy(this.x, this.y, s.range + 30);
    if (target) this.aimAngle = Math.atan2(target.y - 3 - (this.y - 4), target.x - this.x);
    else if (this.moving) this.aimAngle = this.moveAngle;
    else this.aimAngle = this.facing > 0 ? 0 : Math.PI;
    this.facing = Math.cos(this.aimAngle) >= 0 ? 1 : -1;

    this.attackCd = s.attackInterval;
    this.swingT = 0.14;
    this.swingDir *= -1;
    this.attackCount++;
    const rhythm = s.raw.rhythmEvery > 0 && this.attackCount % s.raw.rhythmEvery === 0;

    // Arc hit test.
    const ox = this.x;
    const oy = this.y - 4;
    let hits = 0;
    let crits = 0;
    for (const e of run.enemies) {
      if (e.dead) continue;
      const dx = e.x - ox;
      const dy = e.y - e.radius - oy;
      const d = Math.hypot(dx, dy);
      if (d > s.range + e.radius) continue;
      const inArc = Math.abs(angleDiff(this.aimAngle, Math.atan2(dy, dx))) <= s.arc / 2;
      if (!inArc && d > e.radius + this.radius + 3) continue;
      const res = run.combat.hitEnemy(e, s.damage, { source: 'melee', forceCrit: rhythm, kx: dx, ky: dy, knock: s.knockback });
      if (res) {
        hits++;
        if (res.crit) crits++;
      }
    }
    if (hits > 0) {
      this.energy = Math.min(PLAYER_BASE.energyMax, this.energy + s.energyGain * Math.min(hits, 4));
      run.hooks.hitstop(crits > 0 ? 0.06 : 0.035);
      run.hooks.sfx(crits > 0 ? 'crit' : 'hit');
      if (crits > 0) run.hooks.shake(2.5);
      else run.hooks.shake(1);
    } else {
      run.hooks.sfx('swing');
    }

    const rarityColor = { common: '#f4f2ff', uncommon: '#c7f5b0', rare: '#bfe0ff', epic: '#e2c6ff', legendary: '#ffe0a0' }[this.weapon.rarity];
    run.effects.slash(ox, oy, this.aimAngle, s.arc, s.range, this.swingDir, rarityColor);

    if (s.raw.shadowEvery > 0 && this.attackCount % s.raw.shadowEvery === 0) {
      const count = Math.max(1, s.raw.shadowCount);
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 0.32;
        run.combat.spawnShadowWave(ox, oy, this.aimAngle + spread, s.damage * 0.8);
      }
      run.hooks.sfx('shadow');
    }
  }

  nova() {
    const run = this.run;
    const s = this.stats;
    if (this.energy < PLAYER_BASE.novaCost || this.dead) return;
    this.energy -= PLAYER_BASE.novaCost;
    run.combat.shockwave(this.x, this.y - 4, s.novaRadius, s.damage * s.novaDamageMult, { source: 'nova', knock: 160, color: '#b68cff' });
    this.iframes = Math.max(this.iframes, 0.25);
    run.hooks.sfx('nova');
    run.hooks.shake(5);
    run.hooks.hitstop(0.05);
    run.hooks.haptic(20);
  }

  drinkPotion() {
    const run = this.run;
    if (this.potions <= 0 || this.hp >= this.stats.maxHp || this.dead) return;
    this.potions--;
    const healed = this.heal(this.stats.maxHp * PLAYER_BASE.potionHeal, true);
    run.effects.number(this.x, this.y - 18, `+${Math.round(healed)}`, '#7fd65a', 1);
    run.effects.burst(this.x, this.y - 6, ['#e0384a', '#ff9a9a', '#7fd65a'], 12, 40, 0.5, -30);
    run.hooks.sfx('potion');
  }

  /**
   * @param {number} amount
   * @param {object|null} source the enemy that dealt it (for thorns and the death screen)
   * @param {string} [hazard] name of an environmental hazard; hazards ignore i-frames
   * @returns {number} damage actually taken
   */
  takeDamage(amount, source, hazard = null) {
    const run = this.run;
    if (this.dead || run.ended) return 0;
    if (!hazard && (this.iframes > 0 || this.dashT > 0)) return 0;
    let dmg = amount * (1 - (hazard ? this.stats.armorReduction * 0.5 : this.stats.armorReduction)) * run.playerDamageTakenMult;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) run.effects.ring(this.x, this.y - 6, 12, '#8fd3ff', 0.25, 1);
    }
    dmg = Math.max(dmg > 0 ? 1 : 0, Math.round(dmg));
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    this.regenPause = 2.5;
    this.hurtFlash = 0.18;
    this.lastHitBy = source;
    this.lastHazard = hazard;
    run.stats.damageTaken += dmg;
    run.effects.number(this.x, this.y - 16, dmg, '#ff5a5a', 1);
    if (hazard) {
      run.hooks.sfx('hazard');
    } else {
      this.iframes = PLAYER_BASE.iframes;
      run.hooks.sfx('hurt');
      run.hooks.shake(4);
      run.hooks.haptic(35);
      run.hooks.damageFlash();
      if (source) this.hitFrom = Math.atan2(source.y - this.y, source.x - this.x);
    }

    if (!hazard && source && source.hp > 0 && this.stats.raw.thorns > 0) {
      run.combat.hitEnemy(source, this.stats.damage * this.stats.raw.thorns, { source: 'thorns', noProc: true, noCrit: true });
    }

    if (this.hp <= 0) {
      if (this.revivesLeft > 0) {
        this.revivesLeft--;
        this.hp = Math.round(this.stats.maxHp * 0.5);
        this.iframes = 2;
        run.combat.shockwave(this.x, this.y - 4, 70, this.stats.damage * 2, { source: 'revive', knock: 260, color: '#ffab40' });
        run.hooks.banner('SECOND WIND', 'Death refuses you. Once.', 'gold');
        run.hooks.sfx('legendary');
      } else {
        this.hp = 0;
        this.dead = true;
        run.onPlayerDeath(source, hazard);
      }
    }
    return dmg;
  }

  hasRelic(id) {
    return this.relics.some((r) => r.id === id);
  }

  /** Survival seconds so far — used by a few relic effects. */
  get elapsed() {
    return RUN_DURATION - this.run.timeLeft;
  }
}
