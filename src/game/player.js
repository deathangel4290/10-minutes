// The player: movement, swing, dash, Nova, potions, taking damage, leveling.

import { SKILLS } from '../data/skills.js';
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
    // Active skill (found as loot).
    this.skill = null;
    this.skillCd = 0;
    this.skillCharges = 0;
    this.skillDist = 0;
    this.anchor = null;
    this.sprintT = 0;
    this.trailDist = 0;
    this.rushT = 0;
    this.rushVx = 0;
    this.rushVy = 0;
    this.rushHits = new Set();
    this.stride = 0; // distance walked toward the next Living Storm charge
    this.stormCharged = false;
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
    this.skillCd -= dt;
    this.sprintT -= dt;
    if (this.anchor) {
      this.anchor.t -= dt;
      if (this.anchor.t <= 0) {
        this.anchor = null;
        this.skillCd = 3;
      }
    }
    if (this.shieldT > 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this.shield = 0;
    }

    // Regeneration pauses briefly after every hit, so tanking a crowd doesn't out-heal it.
    this.regenPause -= dt;
    const onTheMove = this.moving || this.dashT > 0;
    const secondWind = s.raw.moveRegen > 0 && onTheMove;
    if (s.regen > 0 && (this.regenPause <= 0 || secondWind)) this.heal(s.regen * (secondWind ? 1 + s.raw.moveRegen : 1) * dt);
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

    const wasDashing = this.dashT > 0;
    if (this.rushT > 0) {
      this.updateRush(dt);
    } else if (this.dashT > 0) {
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
      const speed = s.moveSpeed * mag * this.slowMult * (this.sprintT > 0 ? 1.4 : 1);
      this.x += Math.cos(this.moveAngle) * speed * dt;
      this.y += Math.sin(this.moveAngle) * speed * dt;
    }
    run.map.collide(this, prevX, prevY);
    if (wasDashing && this.dashT <= 0) this.onDashEnd();
    this.afterMove(Math.hypot(this.x - prevX, this.y - prevY));
    if (input.skill && !this.dead) this.useSkill();
    // Living Storm: travelling builds a lightning charge for the next hit.
    if (s.raw.stormStride > 0 && !this.stormCharged) {
      this.stride += Math.hypot(this.x - prevX, this.y - prevY);
      if (this.stride >= 70) {
        this.stride = 0;
        this.stormCharged = true;
        run.effects.ring(this.x, this.y - 6, 12, '#8fd3ff', 0.3, 1);
        run.hooks.sfx('zap');
      }
    }

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
            if (s.raw.orbitIgnite > 0 && !e.dead) run.combat.ignite(e, 1.2);
          }
        }
      }
    }
  }

  equipSkill(item) {
    const def = SKILLS[item.skill];
    this.skill = item;
    this.skillCd = 0;
    this.skillCharges = def.charges || 0;
    this.skillDist = 0;
    this.anchor = null;
    this.sprintT = 0;
  }

  /** Where a skill should go: the nearest foe in reach, else where you're heading. */
  skillAngle(reach) {
    const target = this.run.combat.nearestEnemy(this.x, this.y, reach);
    if (target) return Math.atan2(target.y - this.y, target.x - this.x);
    if (this.moving) return this.moveAngle;
    return this.facing > 0 ? 0 : Math.PI;
  }

  useSkill() {
    if (!this.skill) return;
    const run = this.run;
    const s = this.stats;
    const def = SKILLS[this.skill.skill];
    const power = this.skill.power;
    switch (def.id) {
      case 'bloodrush': {
        if (this.skillCd > 0) return;
        const a = this.skillAngle(120);
        this.rushVx = Math.cos(a) * 340;
        this.rushVy = Math.sin(a) * 340;
        this.rushT = 0.24;
        this.rushHits.clear();
        this.iframes = Math.max(this.iframes, 0.32);
        this.facing = Math.cos(a) >= 0 ? 1 : -1;
        this.skillCd = def.cooldown;
        run.hooks.sfx('lunge');
        run.effects.burst(this.x, this.y - 4, ['#e0384a', '#8e1f2c'], 10, 60, 0.4, 0);
        break;
      }
      case 'thunderstride': {
        if (this.skillCharges <= 0) return;
        this.skillCharges--;
        const a = this.moving ? this.moveAngle : this.skillAngle(90);
        const x0 = this.x;
        const y0 = this.y;
        let x1 = x0;
        let y1 = y0;
        for (let d = 4; d <= 56; d += 4) {
          const nx = x0 + Math.cos(a) * d;
          const ny = y0 + Math.sin(a) * d;
          if (run.map.isSolidAt(nx, ny)) break;
          x1 = nx;
          y1 = ny;
        }
        run.effects.afterimage(x0, y0, 'player_idle', this.facing < 0);
        this.x = x1;
        this.y = y1;
        this.iframes = Math.max(this.iframes, 0.2);
        run.combat.addZapLine(x0, y0 - 4, x1, y1 - 4, s.damage * 0.9 * power);
        run.effects.bolt([[x0, y0 - 6], [(x0 + x1) / 2 + (Math.random() - 0.5) * 6, (y0 + y1) / 2 - 6], [x1, y1 - 6]], '#f4f2ff');
        run.hooks.sfx('zap');
        break;
      }
      case 'riftanchor': {
        if (this.anchor) {
          const a = this.anchor;
          this.anchor = null;
          const dmg = s.damage * 2.2 * power;
          run.combat.shockwave(this.x, this.y - 4, 40, dmg, { source: 'skill', knock: 140, color: '#b68cff' });
          run.effects.afterimage(this.x, this.y, 'player_idle', this.facing < 0);
          this.x = a.x;
          this.y = a.y;
          run.combat.shockwave(this.x, this.y - 4, 40, dmg, { source: 'skill', knock: 140, color: '#d7a8ff' });
          this.iframes = Math.max(this.iframes, 0.35);
          this.skillCd = def.cooldown;
          run.hooks.sfx('runeBlast');
          run.hooks.shake(4);
        } else {
          if (this.skillCd > 0) return;
          this.anchor = { x: this.x, y: this.y, t: def.anchorTime, max: def.anchorTime };
          run.effects.ring(this.x, this.y - 2, 14, '#b68cff', 0.4, 1);
          run.hooks.sfx('rune');
        }
        break;
      }
      case 'wildfire': {
        if (this.skillCd > 0) return;
        this.sprintT = def.duration;
        this.trailDist = 0;
        this.skillCd = def.cooldown;
        run.effects.burst(this.x, this.y - 2, ['#ffd36b', '#ff9a3c', '#c2561f'], 14, 60, 0.5, -20);
        run.hooks.sfx('explode');
        break;
      }
    }
  }

  /** Blood Rush: a fast, invulnerable dash that cuts and bleeds everything it passes. */
  updateRush(dt) {
    const run = this.run;
    const power = this.skill ? this.skill.power : 1;
    this.rushT -= dt;
    this.x += this.rushVx * dt;
    this.y += this.rushVy * dt;
    if (Math.random() < 0.8) run.effects.afterimage(this.x, this.y, this.currentSpriteName(), this.facing < 0);
    for (const e of run.enemies) {
      if (e.dead || this.rushHits.has(e.id)) continue;
      if ((e.x - this.x) ** 2 + (e.y - this.y) ** 2 > (e.radius + this.radius + 6) ** 2) continue;
      this.rushHits.add(e.id);
      run.combat.hitEnemy(e, this.stats.damage * 1.6 * power, { source: 'skill', kx: this.rushVx, ky: this.rushVy, knock: 110 });
      if (!e.dead) run.combat.addBleed(e, 3);
      this.skillCd = Math.max(2, this.skillCd - 0.5);
      run.effects.burst(e.x, e.y - 6, ['#e0384a', '#ff6b6b'], 5, 50, 0.3, 40);
    }
  }

  /** Per-frame bookkeeping that depends on how far you moved. */
  afterMove(moved) {
    const run = this.run;
    const def = this.skill && SKILLS[this.skill.skill];
    if (def && def.charges && this.skillCharges < def.charges) {
      // Thunderstride recharges by travelling, never by waiting.
      this.skillDist += moved;
      if (this.skillDist >= def.chargeDistance) {
        this.skillDist = 0;
        this.skillCharges++;
        run.effects.ring(this.x, this.y - 6, 10, '#8fd3ff', 0.25, 1);
      }
    }
    if (this.sprintT > 0) {
      this.trailDist += moved;
      if (this.trailDist >= 8) {
        this.trailDist = 0;
        run.combat.addFirePatch(this.x, this.y, this.skill ? this.skill.power : 1);
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
    if (s.raw.dashBlades > 0 && s.raw.orbitBlades > 0) {
      const n = s.raw.orbitBlades;
      const r = 22 * (1 + s.raw.areaPct * 0.4);
      for (let i = 0; i < n; i++) {
        const a = this.orbitAngle + (i * Math.PI * 2) / n;
        run.combat.spawnSpectralBolt(this.x + Math.cos(a) * r, this.y - 4 + Math.sin(a) * r, a, s.damage * 0.9);
      }
    }
  }

  /** Iron Maiden: the end of every dash bursts into spikes. */
  onDashEnd() {
    const s = this.stats;
    if (s.raw.dashSpikes <= 0) return;
    this.run.combat.shockwave(this.x, this.y - 4, 36, s.raw.armor * 4 + s.damage, { source: 'spikes', noProc: true, knock: 120, color: '#c9c6dc' });
    this.run.hooks.sfx('slam');
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
    const smashed = run.combat.hitBraziers(ox, oy, s.range, this.aimAngle, s.arc);
    if (smashed > 0 && hits === 0) run.hooks.shake(1.5);
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
