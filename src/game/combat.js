// Damage, status effects, procs and projectiles.

import { ELITE } from '../data/enemies.js';
import { RUN_DURATION } from '../data/config.js';
import { CURSED_ZONE } from '../data/events.js';
import { angleDiff } from '../core/math.js';

const BURN_BASE = 0.35; // burn DPS as a fraction of weapon damage
const BLEED_BASE = 0.16; // per stack
const BLEED_MAX_STACKS = 6;

export class Combat {
  /** A lightning line left by Thunderstride: shocks anything that touches it. */
  addZapLine(x0, y0, x1, y1, dmg, life = 2.2) {
    this.zapLines.push({ x0, y0, x1, y1, dmg, life, max: life, next: new Map() });
  }

  /** A burning patch left by Wildfire Sprint. */
  addFirePatch(x, y, power, life = 2.6) {
    if (this.firePatches.length > 80) this.firePatches.shift();
    this.firePatches.push({ x, y, power, life, max: life });
  }

  updateSkillZones(dt) {
    const run = this.run;
    const t = run.time || 0;
    let w = 0;
    for (const z of this.zapLines) {
      z.life -= dt;
      if (z.life <= 0) continue;
      const dx = z.x1 - z.x0;
      const dy = z.y1 - z.y0;
      const len2 = dx * dx + dy * dy || 1;
      for (const e of run.enemies) {
        if (e.dead || (z.next.get(e.id) || 0) > t) continue;
        const k = Math.max(0, Math.min(1, ((e.x - z.x0) * dx + (e.y - 4 - z.y0) * dy) / len2));
        const px = z.x0 + dx * k;
        const py = z.y0 + dy * k;
        if ((e.x - px) ** 2 + (e.y - 4 - py) ** 2 > (e.radius + 4) ** 2) continue;
        z.next.set(e.id, t + 0.5);
        this.hitEnemy(e, z.dmg, { source: 'skill', noCrit: true, kx: -dy, ky: dx, knock: 30 });
        run.effects.bolt([[px, py - 10], [e.x, e.y - 6]], '#c4e4f5');
      }
      this.zapLines[w++] = z;
    }
    this.zapLines.length = w;
    w = 0;
    for (const f of this.firePatches) {
      f.life -= dt;
      if (f.life <= 0) continue;
      for (const e of run.enemies) {
        if (e.dead || e.burnT > 1.5) continue;
        if ((e.x - f.x) ** 2 + (e.y - f.y) ** 2 < (e.radius + 6) ** 2) this.ignite(e, 1.6 * f.power, 3);
      }
      this.firePatches[w++] = f;
    }
    this.firePatches.length = w;
  }

  constructor(run) {
    this.zapLines = [];
    this.firePatches = [];
    this.run = run;
    this.projectiles = [];
    this.enemyProjectiles = [];
    this.runes = [];
    this.pendingExplosions = [];
  }

  nearestEnemy(x, y, maxDist) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const e of this.run.enemies) {
      if (e.dead || e.spawnT > 0.2) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * Apply player damage to an enemy.
   * opts: source, forceCrit, noCrit, noProc, kx, ky (knock direction), knock (strength)
   */
  hitEnemy(e, base, opts = {}) {
    const run = this.run;
    const p = run.player;
    const s = p.stats;
    if (e.dead || base <= 0) return null;
    let dmg = base;
    const crit = !opts.noCrit && (opts.forceCrit || run.rng.chance(s.critChance));
    if (crit) dmg *= s.critDamage;
    if (e.burnT > 0) dmg *= 1 + s.raw.burnVuln;
    if (e.bleedStacks > 0) dmg *= 1 + s.raw.bleedVuln;
    if (s.raw.killStackDamage > 0) dmg *= 1 + Math.min(0.4, Math.floor(run.stats.kills / 8) * 0.01 * s.raw.killStackDamage);
    if (s.raw.finalRushPct > 0 && run.timeLeft <= 120) dmg *= 1 + s.raw.finalRushPct;
    dmg *= run.rng.range(0.92, 1.08);
    if (s.raw.executeThreshold > 0 && !e.elite && !e.champion && (e.hp - dmg) / e.maxHp < s.raw.executeThreshold) {
      dmg = e.hp;
      run.effects.text(e.x, e.y - 18, 'REAP', '#b68cff', 1, 0.6);
    }
    dmg = Math.max(1, Math.round(dmg));
    e.hp -= dmg;
    e.flash = 0.09;
    run.stats.damageDealt += dmg;

    const h = e.def.scale ? 16 * e.def.scale : 14;
    run.effects.number(e.x, e.y - h, dmg, crit ? '#ffab40' : opts.source === 'thorns' ? '#7fd65a' : '#f4f2ff', crit ? 2 : 1, e.id);
    if (crit && run.effects.quality) run.effects.burst(e.x, e.y - 6, ['#ffd36b', '#ff9a3c'], 5, 50, 0.25, 0);

    // Knockback and a short stagger (elites keep their poise).
    if (opts.knock && (opts.kx || opts.ky)) {
      const l = Math.hypot(opts.kx, opts.ky) || 1;
      const k = opts.knock * e.knockTaken * (crit ? 1.35 : 1);
      e.vx += (opts.kx / l) * k;
      e.vy += (opts.ky / l) * k;
    }
    if (!e.elite && !e.champion && opts.source !== 'dot') {
      e.stun = Math.max(e.stun, opts.source === 'melee' ? 0.14 : 0.08);
      if (e.state === 'windup' && e.def.behavior === 'melee') {
        e.state = 'chase';
        e.attackCd = 0.35;
      }
    }

    // Lifesteal only from your own attacks (not thorns or DoTs), and capped per second.
    const own = opts.source !== 'dot' && opts.source !== 'thorns';
    if (s.lifesteal > 0 && own) p.lifestealHeal(dmg * s.lifesteal);
    if (crit && own && s.raw.critHeal > 0) {
      p.lifestealHeal(s.maxHp * s.raw.critHeal);
      this.addBleed(e, 2);
    }
    // Living Storm: a charge built by moving is released by the next swing.
    if (opts.source === 'melee' && p.stormCharged && !e.dead) {
      p.stormCharged = false;
      run.effects.bolt([[e.x + 4, e.y - 70], [e.x - 2, e.y - 40], [e.x + 1, e.y - 6]], '#c4e4f5');
      this.chainLightning(e, s.damage * 1.4, 5);
    }

    if (!opts.noProc) {
      const wd = s.damage;
      if (s.raw.burnChance > 0 && run.rng.chance(s.raw.burnChance)) {
        e.burnT = 3;
        e.burnDps = Math.max(e.burnDps * 0.5, wd * BURN_BASE * (1 + s.raw.burnPower));
      }
      if (s.raw.bleedChance > 0 && run.rng.chance(s.raw.bleedChance)) {
        e.bleedStacks = Math.min(BLEED_MAX_STACKS, e.bleedStacks + 1);
        e.bleedT = 4;
        e.bleedDps = wd * BLEED_BASE * (1 + s.raw.bleedPower);
      }
      if (s.raw.chainChance > 0 && run.rng.chance(s.raw.chainChance)) this.chainLightning(e, wd * 0.7, Math.max(1, s.raw.chainCount));
      if (crit && s.raw.critNova > 0) this.shockwave(e.x, e.y - 4, 24, wd * s.raw.critNova, { source: 'shatter', noProc: true, knock: 50, color: '#ffd36b' });
    }

    if (e.hp <= 0) this.killEnemy(e);
    return { dmg, crit };
  }

  killEnemy(e) {
    const run = this.run;
    const p = run.player;
    if (e.dead) return;
    e.dead = true;
    run.stats.kills++;
    if (e.elite) run.stats.elites++;
    if (e.champion) run.stats.champions++;
    const big = e.elite || e.champion;
    run.effects.burst(e.x, e.y - 6, e.def.deathColors, big ? 26 : 12, big ? 90 : 65, 0.55, 60);
    // What it leaves behind: burned foes leave scorch, the rest their own remains.
    const mark = e.burnT > 0 ? 'scorch' : e.def.decal;
    if (mark) {
      run.effects.decal(e.x, e.y - 1, mark);
      if (big) for (let i = 0; i < (e.champion ? 4 : 2); i++) run.effects.decal(e.x + (Math.random() - 0.5) * 16, e.y + (Math.random() - 0.5) * 8, mark);
    }
    run.hooks.sfx(big ? 'eliteDie' : 'die');
    if (big) {
      run.hooks.shake(e.champion ? 9 : 4);
      run.hooks.hitstop(e.champion ? 0.2 : 0.08);
    }
    if (p.stats.raw.lifeOnKill > 0) p.heal(p.stats.raw.lifeOnKill);

    // Drops.
    const elapsed = RUN_DURATION - run.timeLeft;
    const xpScale = 1 + (elapsed / RUN_DURATION) * 0.9;
    let xp = e.def.xp * xpScale * (e.elite ? ELITE.xpMult : 1) * (e.cursed ? 1.5 : 1);
    run.pickups.dropXp(e.x, e.y, xp);
    const [gmin, gmax] = e.def.gold;
    let gold = run.rng.int(gmin, gmax) * (e.elite ? ELITE.goldMult : 1) * (e.cursed ? 1.6 : 1) * (1 + elapsed / 420);
    if (gold > 0) run.pickups.dropGold(e.x, e.y, Math.round(gold));

    const rarityBump = (e.elite ? ELITE.dropRarityBump : 0) + (e.cursed ? CURSED_ZONE.rarityBump : 0);
    if (e.elite || e.champion) {
      // Skills come from elites: the first one in a run is guaranteed, so you meet the Skill button early.
      const first = !p.skill && !run.skillDropped;
      if (e.champion || first || run.rng.chance(0.14)) {
        run.skillDropped = true;
        run.pickups.dropItem(e.x + 6, e.y, run.pickups.rollItem({ forceKind: 'skill', bump: rarityBump, minRarity: e.champion ? 'rare' : 'common' }));
      }
    }
    if (p.sprintT > 0) p.skillCd = Math.max(0, p.skillCd - 0.6); // Wildfire Sprint: kills cut the cooldown
    if (e.champion) {
      run.pickups.dropChest(e.x, e.y, run.rng.chance(0.45) ? 'legendary' : 'epic', { champion: true });
    } else if (e.elite && run.rng.chance(0.3)) {
      run.pickups.dropRandomItem(e.x, e.y, { bump: rarityBump, levelBonus: 0 });
    } else if (run.rng.chance(e.cursed ? 0.04 : 0.006)) {
      run.pickups.dropRandomItem(e.x, e.y, { bump: rarityBump });
    } else if (run.rng.chance(0.006)) {
      run.pickups.dropPotion(e.x, e.y);
    }

    if (e.def.splitInto) {
      for (let i = 0; i < e.def.splitCount; i++) {
        const child = run.director.spawnAt(e.def.splitInto, e.x + run.rng.range(-5, 5), e.y + run.rng.range(-5, 5), { cursed: e.cursed });
        if (child) {
          child.spawnT = 0;
          child.vx = run.rng.range(-60, 60);
          child.vy = run.rng.range(-60, 60);
        }
      }
    }

    if (p.stats.raw.explodeChance > 0 && run.rng.chance(p.stats.raw.explodeChance)) {
      this.pendingExplosions.push({ x: e.x, y: e.y - 4, dmg: p.stats.damage * (0.8 + p.stats.raw.explodePower) });
    }
  }

  /** Set an enemy alight. `mult` scales the burn relative to a normal ignite. */
  ignite(e, mult = 1, time = 3) {
    const s = this.run.player.stats;
    e.burnT = Math.max(e.burnT, time);
    e.burnDps = Math.max(e.burnDps, s.damage * BURN_BASE * mult * (1 + s.raw.burnPower));
  }

  /** Open bleeding wounds (stacks). */
  addBleed(e, stacks = 1) {
    const s = this.run.player.stats;
    e.bleedStacks = Math.min(BLEED_MAX_STACKS, e.bleedStacks + stacks);
    e.bleedT = 4;
    e.bleedDps = Math.max(e.bleedDps, s.damage * BLEED_BASE * (1 + s.raw.bleedPower));
  }

  /** Damage-over-time ticks (burn, bleed). */
  updateStatus(e, dt) {
    if (e.burnT <= 0 && e.bleedT <= 0) return;
    let dps = 0;
    if (e.burnT > 0) {
      e.burnT -= dt;
      dps += e.burnDps;
      if (Math.random() < dt * 14) this.run.effects.particle(e.x + (Math.random() - 0.5) * 8, e.y - 6 - Math.random() * 6, 0, -20, 0.4, Math.random() < 0.5 ? '#ff9a3c' : '#ffd36b', 1, -10, 1);
    }
    if (e.bleedT > 0) {
      e.bleedT -= dt;
      dps += e.bleedDps * e.bleedStacks;
      if (e.bleedT <= 0) e.bleedStacks = 0;
      if (Math.random() < dt * 8) this.run.effects.particle(e.x + (Math.random() - 0.5) * 6, e.y - 6, 0, 10, 0.4, '#e0384a', 1, 60, 1);
    }
    e.dotAccum += dps * dt;
    e.dotTick -= dt;
    if (e.dotTick <= 0 && e.dotAccum >= 1) {
      e.dotTick = 0.45;
      const amount = e.dotAccum;
      e.dotAccum = 0;
      this.applyDot(e, amount);
    }
  }

  applyDot(e, amount) {
    const run = this.run;
    const dmg = Math.max(1, Math.round(amount));
    e.hp -= dmg;
    run.stats.damageDealt += dmg;
    run.effects.number(e.x, e.y - 12, dmg, e.burnT > 0 ? '#ff9a3c' : '#e0384a', 1, e.id);
    if (e.hp <= 0) this.killEnemy(e);
  }

  chainLightning(from, dmg, count) {
    const run = this.run;
    const hit = new Set([from.id]);
    let cur = from;
    const points = [[from.x, from.y - 6]];
    for (let i = 0; i < count; i++) {
      let best = null;
      let bestD = 70 * 70;
      for (const e of run.enemies) {
        if (e.dead || hit.has(e.id)) continue;
        const d = (e.x - cur.x) ** 2 + (e.y - cur.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
      if (!best) break;
      hit.add(best.id);
      points.push([best.x, best.y - 6]);
      const burning = best.burnT > 0;
      this.hitEnemy(best, dmg, { source: 'chain', noProc: true, noCrit: true });
      const s = run.player.stats;
      if (s.raw.chainBleed > 0 && !best.dead) this.addBleed(best, s.raw.chainBleed);
      if (s.raw.overload > 0 && burning) this.pendingExplosions.push({ x: best.x, y: best.y - 4, dmg: s.damage * 0.9 });
      cur = best;
    }
    if (points.length > 1) {
      run.effects.bolt(points, '#8fd3ff');
      run.hooks.sfx('zap');
    }
  }

  /**
   * Smash braziers caught in a swing (aim + arc) or a blast (no aim).
   * Returns how many broke.
   */
  hitBraziers(x, y, range, aim = null, arc = 0) {
    const run = this.run;
    let broke = 0;
    for (const poi of run.pois) {
      if (poi.type !== 'brazier' || !poi.lit) continue;
      const dx = poi.x - x;
      const dy = poi.y - 6 - y;
      const d = Math.hypot(dx, dy);
      if (d > range + 5) continue;
      if (aim !== null && d > 10 && Math.abs(angleDiff(aim, Math.atan2(dy, dx))) > arc / 2) continue;
      this.breakBrazier(poi);
      broke++;
    }
    return broke;
  }

  breakBrazier(poi) {
    const run = this.run;
    poi.lit = false;
    run.effects.burst(poi.x, poi.y - 8, ['#ffd36b', '#ff9a3c', '#c2561f', '#5a5374'], 16, 70, 0.6, 60);
    run.effects.decal(poi.x, poi.y + 1, 'scorch');
    run.hooks.sfx('brazier');
    const ph = run.phase.id;
    run.pickups.dropGold(poi.x, poi.y - 4, run.rng.int(6, 12) + ph * 5);
    if (run.rng.chance(0.4)) run.pickups.dropXp(poi.x, poi.y - 4, 3 + ph * 2);
    if (run.rng.chance(0.08)) run.pickups.dropPotion(poi.x, poi.y - 4);
  }

  shockwave(x, y, radius, dmg, opts = {}) {
    const run = this.run;
    run.effects.ring(x, y, radius, opts.color || '#b68cff', 0.35, 2);
    if (opts.source === 'nova' || opts.source === 'explode') this.hitBraziers(x, y, radius);
    if (run.effects.quality) run.effects.burst(x, y, [opts.color || '#b68cff', '#f4f2ff'], 14, radius * 2.2, 0.35, 0);
    for (const e of run.enemies) {
      if (e.dead) continue;
      const dx = e.x - x;
      const dy = e.y - 4 - y;
      if (dx * dx + dy * dy > (radius + e.radius) ** 2) continue;
      this.hitEnemy(e, dmg, { source: opts.source || 'aoe', noProc: opts.noProc, kx: dx, ky: dy, knock: opts.knock || 60 });
      if (opts.source === 'nova' && run.player.stats.raw.novaIgnite > 0 && !e.dead) this.ignite(e, 3, 4);
    }
  }

  spawnShadowWave(x, y, angle, dmg) {
    if (this.run.player.stats.raw.shadowReturn > 0) {
      // Umbral Crescent: a huge wave that flies out and comes back.
      this.projectiles.push({ kind: 'shadow', big: true, x, y, vx: Math.cos(angle) * 160, vy: Math.sin(angle) * 160, angle, life: 1.15, turnAt: 0.6, dmg: dmg * 1.15, radius: 13, hits: new Set() });
      return;
    }
    this.projectiles.push({ kind: 'shadow', x, y, vx: Math.cos(angle) * 150, vy: Math.sin(angle) * 150, angle, life: 0.75, dmg, radius: 8, hits: new Set() });
  }

  /** A piercing spectral bolt (Wraith Procession). */
  spawnSpectralBolt(x, y, angle, dmg) {
    this.projectiles.push({ kind: 'spectral', x, y, vx: Math.cos(angle) * 200, vy: Math.sin(angle) * 200, angle, life: 0.55, dmg, radius: 7, hits: new Set() });
  }

  fireArrow(e, dirX, dirY) {
    const sp = e.def.projSpeed;
    this.enemyProjectiles.push({ kind: 'arrow', x: e.x + dirX * 6, y: e.y - 7 + dirY * 6, vx: dirX * sp, vy: dirY * sp, life: 1.6, dmg: e.damage, radius: 3, source: e });
  }

  /** A delayed blast: telegraphed circle on the ground that detonates after `delay`. */
  addRune(x, y, radius, delay, dmg, opts = {}) {
    this.runes.push({ x, y, radius, delay, t: 0, dmg, source: opts.source || null, color: opts.color || 'purple', hitsEnemies: !!opts.hitsEnemies, kind: opts.kind || 'rune', name: opts.name || null });
  }

  enemySlam(e, radius) {
    const run = this.run;
    const p = run.player;
    run.effects.ring(e.x, e.y - 2, radius, '#e0384a', 0.4, 2);
    run.effects.burst(e.x, e.y, ['#5a5374', '#8a84a6', '#e0384a'], 18, 120, 0.4, 80);
    run.hooks.shake(6);
    run.hooks.sfx('slam');
    if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < (radius + p.radius) ** 2) p.takeDamage(e.damage, e);
  }

  update(dt) {
    this.updateSkillZones(dt);
    const run = this.run;
    const pl = run.player;
    // Enemy arrows.
    let ew = 0;
    for (const pr of this.enemyProjectiles) {
      pr.life -= dt;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.life <= 0 || run.map.isSolidAt(pr.x, pr.y + 6)) continue;
      if (!pl.dead && (pl.x - pr.x) ** 2 + (pl.y - 6 - pr.y) ** 2 < (pl.radius + pr.radius) ** 2) {
        if (pl.dashT <= 0) {
          pl.takeDamage(pr.dmg, pr.source || null);
          continue;
        }
      }
      this.enemyProjectiles[ew++] = pr;
    }
    this.enemyProjectiles.length = ew;

    // Runes and eruptions.
    let rw = 0;
    for (const r of this.runes) {
      r.t += dt;
      if (r.t < r.delay) {
        this.runes[rw++] = r;
        continue;
      }
      const lava = r.color === 'orange';
      run.effects.ring(r.x, r.y, r.radius, lava ? '#ff9a3c' : '#b68cff', 0.35, 2);
      run.effects.decal(r.x, r.y, lava ? 'scorch' : 'ash');
      run.effects.burst(r.x, r.y - 2, lava ? ['#ff9a3c', '#ffd36b', '#c2410c'] : ['#b68cff', '#7a3fc0', '#f4f2ff'], 14, 70, 0.45, lava ? 60 : 0);
      run.hooks.sfx(lava ? 'explode' : 'runeBlast');
      if (!pl.dead && (pl.x - r.x) ** 2 + (pl.y - r.y) ** 2 < (r.radius + pl.radius) ** 2) {
        if (r.name) pl.takeDamage(r.dmg, null, r.name);
        else pl.takeDamage(r.dmg, r.source || null);
      }
      if (r.hitsEnemies) {
        for (const e of run.enemies) {
          if (e.dead || (e.x - r.x) ** 2 + (e.y - r.y) ** 2 > (r.radius + e.radius) ** 2) continue;
          e.hp -= r.dmg;
          e.flash = 0.1;
          run.effects.number(e.x, e.y - 12, Math.round(r.dmg), '#ff9a3c', 1);
          if (e.hp <= 0) this.killEnemy(e);
        }
      }
    }
    this.runes.length = rw;

    // Projectiles.
    let w = 0;
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.turnAt && pr.life <= pr.turnAt) {
        // Turn around and fly back through the crowd toward the player.
        pr.turnAt = 0;
        const a = Math.atan2(pl.y - 4 - pr.y, pl.x - pr.x);
        pr.vx = Math.cos(a) * 170;
        pr.vy = Math.sin(a) * 170;
        pr.angle = a;
        pr.hits.clear();
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (pr.life <= 0 || run.map.isSolidAt(pr.x, pr.y + 4)) continue;
      for (const e of run.enemies) {
        if (e.dead || pr.hits.has(e.id)) continue;
        if ((e.x - pr.x) ** 2 + (e.y - 5 - pr.y) ** 2 < (e.radius + pr.radius) ** 2) {
          pr.hits.add(e.id);
          this.hitEnemy(e, pr.dmg, { source: pr.kind, kx: pr.vx, ky: pr.vy, knock: 50, noProc: true });
        }
      }
      const trail = pr.kind === 'spectral' ? ['#c4e4f5', '#f4f2ff'] : ['#7a3fc0', '#b68cff'];
      if (Math.random() < 0.7) run.effects.particle(pr.x + (Math.random() - 0.5) * 8, pr.y + (Math.random() - 0.5) * 8, 0, 0, 0.25, trail[Math.random() < 0.5 ? 0 : 1], 1, 0, 0);
      this.projectiles[w++] = pr;
    }
    this.projectiles.length = w;

    // Deferred explosions (avoids deep recursion when explosions chain).
    if (this.pendingExplosions.length) {
      const list = this.pendingExplosions;
      this.pendingExplosions = [];
      for (const ex of list.slice(0, 6)) {
        this.shockwave(ex.x, ex.y, 26, ex.dmg, { source: 'explode', noProc: true, knock: 80, color: '#ff9a3c' });
        run.effects.decal(ex.x, ex.y + 3, 'scorch');
        run.hooks.sfx('explode');
      }
    }
  }
}

