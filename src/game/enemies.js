// Enemy entities and their AI behaviors. Every enemy telegraphs its attack
// (raised blade, crouch, ground circle) so the player can react.

import { ENEMIES, ELITE } from '../data/enemies.js';
import { enemyScaling, RUN_DURATION } from '../data/config.js';
import { CURSED_ZONE } from '../data/events.js';

let nextId = 1;
const tmpDir = { x: 0, y: 0 };

export class Enemy {
  constructor(run, type, x, y, { elite = false, cursed = false, guard = false } = {}) {
    const def = ENEMIES[type];
    const scale = enemyScaling(RUN_DURATION - run.timeLeft);
    this.id = nextId++;
    this.def = def;
    this.type = type;
    this.x = x;
    this.y = y;
    this.vx = 0; // knockback velocity
    this.vy = 0;
    this.elite = elite;
    this.cursed = cursed;
    this.guard = guard;
    this.champion = type === 'champion';
    const hpMult = scale.hp * (elite ? ELITE.hpMult : 1) * (cursed ? CURSED_ZONE.hpMult : 1);
    this.maxHp = Math.round(def.hp * hpMult);
    this.hp = this.maxHp;
    this.damage = def.damage * scale.damage * (elite ? ELITE.damageMult : 1) * (cursed ? CURSED_ZONE.damageMult : 1);
    const surge = run.timeLeft <= 60 ? 1.12 : 1;
    this.speed = def.speed * scale.speed * surge * (elite ? ELITE.speedMult : 1) * run.rng.range(0.92, 1.08);
    this.radius = def.radius + (elite ? 1 : 0);
    this.knockTaken = def.knockbackTaken * (elite ? ELITE.knockbackMult : 1);
    this.state = 'chase';
    this.timer = 0;
    this.attackCd = run.rng.range(0.4, 1.2);
    this.facing = 1;
    this.flash = 0;
    this.stun = 0;
    this.animT = run.rng.range(0, 1);
    this.spawnT = 0.35; // fade/rise-in time
    this.burnT = 0;
    this.burnDps = 0;
    this.bleedT = 0;
    this.bleedStacks = 0;
    this.bleedDps = 0;
    this.dotTick = 0;
    this.dotAccum = 0;
    this.orbitCd = 0;
    this.touchCd = 0;
    this.lungeHit = false;
    this.lungeDx = 0;
    this.lungeDy = 0;
    this.summonT = 6;
    this.dead = false;
    this.ageNoSight = 0;
  }

  get sprite() {
    return this.def.sprite;
  }
}

/** Advance one enemy. Separation and map collision are applied by the caller. */
export function updateEnemy(run, e, dt) {
  const p = run.player;
  e.prevX = e.x;
  e.prevY = e.y;
  e.animT += dt;
  e.flash -= dt;
  e.orbitCd -= dt;
  e.touchCd -= dt;
  e.attackCd -= dt;
  if (e.spawnT > 0) e.spawnT -= dt;

  // Knockback velocity decays quickly.
  if (e.vx !== 0 || e.vy !== 0) {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    const d = Math.exp(-10 * dt);
    e.vx *= d;
    e.vy *= d;
    if (Math.abs(e.vx) < 2 && Math.abs(e.vy) < 2) e.vx = e.vy = 0;
  }

  if (e.spawnT > 0.12) return; // still rising out of the ground

  const dx = p.x - e.x;
  const dy = p.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  if (e.state !== 'lunge' && e.state !== 'windup') e.facing = dx >= 0 ? 1 : -1;

  if (e.stun > 0) {
    e.stun -= dt;
    return;
  }
  if (p.dead) return;

  switch (e.def.behavior) {
    case 'melee':
      meleeAI(run, e, dt, dx, dy, dist);
      break;
    case 'hopper':
      hopperAI(run, e, dt, dx, dy, dist);
      break;
    case 'lunger':
      lungerAI(run, e, dt, dx, dy, dist);
      break;
    case 'champion':
      championAI(run, e, dt, dx, dy, dist);
      break;
  }
}

function moveToward(run, e, dt, dx, dy, dist, speedMult = 1) {
  let mx = dx / dist;
  let my = dy / dist;
  if (dist > 30 && run.map.flowDir(e.x, e.y, tmpDir)) {
    mx = tmpDir.x;
    my = tmpDir.y;
  }
  const sp = e.speed * speedMult;
  e.x += mx * sp * dt;
  e.y += my * sp * dt;
}

function meleeAI(run, e, dt, dx, dy, dist) {
  const reach = e.def.attackRange + run.player.radius;
  if (e.state === 'windup') {
    e.timer -= dt;
    if (e.timer <= 0) {
      if (dist <= reach + 4) run.player.takeDamage(e.damage, e);
      run.effects.slash(e.x, e.y - 6, Math.atan2(dy, dx), 1.6, reach, e.facing, '#ff9a9a');
      e.state = 'recover';
      e.timer = 0.3;
      e.attackCd = e.def.attackCooldown;
    }
    return;
  }
  if (e.state === 'recover') {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (dist <= reach && e.attackCd <= 0) {
    e.state = 'windup';
    e.timer = e.def.windup * (e.elite ? 0.85 : 1);
    return;
  }
  if (dist > reach * 0.7) moveToward(run, e, dt, dx, dy, dist);
}

function hopperAI(run, e, dt, dx, dy, dist) {
  e.timer -= dt;
  if (e.state === 'chase') {
    e.state = 'rest';
    e.timer = e.def.restTime * run.rng.range(0.7, 1.3);
  }
  if (e.state === 'rest') {
    if (e.timer <= 0) {
      e.state = 'hop';
      e.timer = e.def.hopTime;
    }
  } else if (e.state === 'hop') {
    moveToward(run, e, dt, dx, dy, dist);
    if (e.timer <= 0) {
      e.state = 'rest';
      e.timer = e.def.restTime * run.rng.range(0.7, 1.3);
    }
  }
  // Contact damage.
  if (dist < e.radius + run.player.radius + 1 && e.touchCd <= 0) {
    e.touchCd = 0.8;
    run.player.takeDamage(e.damage, e);
  }
}

function lungerAI(run, e, dt, dx, dy, dist) {
  const p = run.player;
  if (e.state === 'windup') {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'lunge';
      e.timer = e.def.lungeTime;
      e.lungeHit = false;
      run.hooks.sfx('lunge');
    }
    return;
  }
  if (e.state === 'lunge') {
    e.timer -= dt;
    e.x += e.lungeDx * e.def.lungeSpeed * dt;
    e.y += e.lungeDy * e.def.lungeSpeed * dt;
    if (!e.lungeHit && dist < e.radius + p.radius + 3) {
      e.lungeHit = true;
      p.takeDamage(e.damage, e);
    }
    if (e.timer <= 0) {
      e.state = 'recover';
      e.timer = 0.45;
      e.attackCd = e.def.attackCooldown;
    }
    return;
  }
  if (e.state === 'recover') {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (dist < e.def.lungeRange && dist > 14 && e.attackCd <= 0) {
    e.state = 'windup';
    e.timer = e.def.lungeWindup * (e.elite ? 0.85 : 1);
    // Aim slightly ahead of where the player is moving.
    const lead = p.moving ? 0.18 : 0;
    const tx = p.x + Math.cos(p.moveAngle) * p.stats.moveSpeed * lead;
    const ty = p.y + Math.sin(p.moveAngle) * p.stats.moveSpeed * lead;
    const l = Math.hypot(tx - e.x, ty - e.y) || 1;
    e.lungeDx = (tx - e.x) / l;
    e.lungeDy = (ty - e.y) / l;
    e.facing = e.lungeDx >= 0 ? 1 : -1;
    return;
  }
  // Circle-strafe a little when close so packs surround the player.
  if (dist < 60) {
    const side = e.id % 2 === 0 ? 1 : -1;
    const tx = dx / dist;
    const ty = dy / dist;
    e.x += (tx * 0.6 - ty * side * 0.8) * e.speed * dt;
    e.y += (ty * 0.6 + tx * side * 0.8) * e.speed * dt;
  } else {
    moveToward(run, e, dt, dx, dy, dist);
  }
}

function championAI(run, e, dt, dx, dy, dist) {
  const reach = e.def.attackRange;
  e.summonT -= dt;
  if (e.summonT <= 0) {
    e.summonT = 9;
    for (let i = 0; i < 3; i++) run.director.spawnNear('skeleton', e.x, e.y, 20, 40, {});
    run.effects.ring(e.x, e.y - 8, 40, '#7a3fc0', 0.5, 2);
    run.hooks.sfx('summon');
  }
  if (e.state === 'windup') {
    e.timer -= dt;
    if (e.timer <= 0) {
      run.combat.enemySlam(e, e.def.slamRadius);
      e.state = 'recover';
      e.timer = 0.6;
      e.attackCd = e.def.attackCooldown;
    }
    return;
  }
  if (e.state === 'recover') {
    e.timer -= dt;
    if (e.timer <= 0) e.state = 'chase';
    return;
  }
  if (dist <= reach && e.attackCd <= 0) {
    e.state = 'windup';
    e.timer = e.def.windup;
    return;
  }
  moveToward(run, e, dt, dx, dy, dist);
}
