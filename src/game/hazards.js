// Environmental pressure. Every region punishes standing still in its own
// way, and the "Hunted" rule applies everywhere: linger in one small area and
// the dark sends more, tougher enemies straight at you.

import { TILE } from '../data/config.js';
import { T } from './map.js';

export const HUNT_RADIUS = 100;
export const HUNT_TIME = 30;
const FROST_LIMIT = 4; // seconds standing still before frostbite
const SPIKE_CYCLE = 2.6;

export class Hazards {
  constructor(run) {
    this.run = run;
    this.anchor = { x: run.player.x, y: run.player.y };
    this.stillT = 0;
    this.lavaT = 0;
    this.eruptT = 25;
    this.frostTick = 0;
    this.spikeClock = 0;
    run.hunted = false;
    run.frost = 0;
  }

  update(dt) {
    const run = this.run;
    const p = run.player;
    if (p.dead) return;
    const scale = 1 + run.phase.id * 0.45;
    const diff = run.biome.difficulty;

    // Hunted: lingering in one area draws the dark to you.
    if ((p.x - this.anchor.x) ** 2 + (p.y - this.anchor.y) ** 2 > HUNT_RADIUS * HUNT_RADIUS) {
      this.anchor = { x: p.x, y: p.y };
      this.stillT = 0;
      if (run.hunted) {
        run.hunted = false;
        run.hooks.toast('You slipped away. The hunt eases.', 'purple');
      }
    } else {
      this.stillT += dt;
      if (this.stillT > HUNT_TIME && !run.hunted && run.elapsed > 40) {
        run.hunted = true;
        run.hooks.banner('HUNTED', 'You stayed too long. Keep moving!', 'danger');
        run.hooks.sfx('ambush');
      }
    }
    run.huntProgress = Math.min(1, this.stillT / HUNT_TIME);

    // Lava burns anyone standing in it.
    if (run.map.tileAt(p.x, p.y) === T.LAVA) {
      this.lavaT -= dt;
      if (this.lavaT <= 0) {
        this.lavaT = 0.4;
        p.takeDamage((2.5 + 2 * run.phase.id) * diff, null, 'Lava');
        run.effects.burst(p.x, p.y - 4, ['#ff9a3c', '#ffd36b'], 5, 40, 0.4, -30);
      }
    } else this.lavaT = 0;
    for (const e of run.enemies) {
      if (e.dead || run.map.tileAt(e.x, e.y) !== T.LAVA) continue;
      e.hazardT -= dt;
      if (e.hazardT <= 0) {
        e.hazardT = 0.5;
        run.combat.applyDot(e, (6 + 4 * run.phase.id) * diff);
      }
    }

    const hz = run.biome.hazard;
    if (hz === 'eruptions') this.updateEruptions(dt, scale, diff);
    if (hz === 'frost') this.updateFrost(dt);
    if (run.map.spikes.length) this.updateSpikes(dt, scale, diff);
  }

  /** The caldera erupts under and around you. */
  updateEruptions(dt, scale, diff) {
    const run = this.run;
    const p = run.player;
    this.eruptT -= dt;
    if (this.eruptT > 0) return;
    this.eruptT = run.rng.range(6, 9.5) * (1 - run.phase.id * 0.12);
    const count = Math.min(4, 1 + run.phase.id);
    for (let i = 0; i < count; i++) {
      // The first one lands right where you are standing.
      const pt = i === 0 ? { x: p.x + run.rng.range(-6, 6), y: p.y + run.rng.range(-6, 6) } : run.map.findOpenPoint(run.rng, p.x, p.y, 24, 90, 8);
      if (!pt) continue;
      run.combat.addRune(pt.x, pt.y, 18, 1.4, 10 * scale * diff, { color: 'orange', hitsEnemies: true, kind: 'eruption', name: 'Eruption' });
    }
    run.hooks.sfx('rumble');
    run.hooks.shake(2);
  }

  /** Frostbite: stand still too long in the tundra and the cold bites. Campfires keep you warm. */
  updateFrost(dt) {
    const run = this.run;
    const p = run.player;
    const warm = run.pois.some((poi) => poi.type === 'camp' && (poi.x - p.x) ** 2 + (poi.y - p.y) ** 2 < 46 * 46);
    if (warm) run.frost = Math.max(0, run.frost - dt * 3);
    else if (p.moving || p.dashT > 0) run.frost = Math.max(0, run.frost - dt * 2);
    else run.frost += dt;
    p.slowMult = run.frost > 2 ? 1 - Math.min(0.35, (run.frost - 2) * 0.15) : 1;
    if (run.frost > FROST_LIMIT) {
      this.frostTick -= dt;
      if (this.frostTick <= 0) {
        this.frostTick = 0.5;
        p.takeDamage(p.stats.maxHp * 0.03, null, 'Frostbite');
        run.effects.burst(p.x, p.y - 6, ['#c4e4f5', '#8fd3ff'], 5, 30, 0.5, 0);
      }
    }
    run.frostProgress = Math.min(1, run.frost / FROST_LIMIT);
  }

  /** Crypt spike traps cycle: retracted, warning, then up. */
  updateSpikes(dt, scale, diff) {
    const run = this.run;
    const p = run.player;
    this.spikeClock += dt;
    const ptx = Math.floor(p.x / TILE);
    const pty = Math.floor(p.y / TILE);
    for (const s of run.map.spikes) {
      const t = (this.spikeClock + s.phase * 0.85) % SPIKE_CYCLE;
      const prev = s.state;
      s.state = t < 1.5 ? 'down' : t < 2.0 ? 'warn' : 'up';
      if (s.state === 'up' && prev !== 'up') {
        s.hitPlayer = false;
        for (const e of run.enemies) {
          if (!e.dead && Math.floor(e.x / TILE) === s.tx && Math.floor(e.y / TILE) === s.ty) run.combat.applyDot(e, 12 * scale * diff);
        }
      }
      if (s.state === 'up' && !s.hitPlayer && s.tx === ptx && s.ty === pty && p.dashT <= 0) {
        s.hitPlayer = true;
        p.takeDamage(10 * scale * diff, null, 'Spike trap');
      }
    }
  }
}
