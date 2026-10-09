// Headless balance simulation: a simple bot plays full runs.
// Usage: node tools/sim.mjs [runs=5] [unlockAll=0] [metaLevel=0] [biome=forest] [style=normal|turtle]

import { Run } from '../src/game/run.js';
import { META_UPGRADES, META_UNLOCKS } from '../src/data/meta.js';

const runs = Number(process.argv[2] || 5);
const unlockAll = process.argv[3] === '1';
const metaLevel = Number(process.argv[4] || 0);
const biome = process.argv[5] || 'forest';
const style = process.argv[6] || 'normal';

const meta = Object.fromEntries(META_UPGRADES.map((m) => [m.id, Math.min(metaLevel, m.costs.length)]));
const unlocks = Object.fromEntries(META_UNLOCKS.map((u) => [u.id, unlockAll]));

// BFS from a goal so the bot can actually walk to a gate.
const goalFlows = new Map();
function pathStep(run, goal) {
  const m = run.map;
  const N = m.n;
  const key = `${run.seed}|${goal.x}|${goal.y}`;
  let dist = goalFlows.get(key);
  if (!dist) {
    dist = new Int32Array(N * N).fill(-1);
    const q = [];
    const gi = Math.floor(goal.y / 16) * N + Math.floor(goal.x / 16);
    dist[gi] = 0;
    q.push(gi);
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const x = i % N;
      const y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (m.isSolid(nx, ny)) continue;
        const ni = ny * N + nx;
        if (dist[ni] >= 0) continue;
        dist[ni] = dist[i] + 1;
        q.push(ni);
      }
    }
    goalFlows.set(key, dist);
  }
  const p = run.player;
  const tx = Math.floor(p.x / 16);
  const ty = Math.floor(p.y / 16);
  let best = dist[ty * N + tx];
  let bx = 0;
  let by = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const d = dist[(ty + dy) * N + tx + dx];
    if (d >= 0 && d < best) {
      best = d;
      bx = dx;
      by = dy;
    }
  }
  if (bx === 0 && by === 0) return { x: goal.x - p.x, y: goal.y - p.y };
  return { x: (tx + bx) * 16 + 8 - p.x, y: (ty + by) * 16 + 8 - p.y };
}

function nearestChest(run, maxD) {
  const p = run.player;
  let best = null;
  let bd = maxD;
  for (const c of run.pois) {
    if (c.type !== 'chest' || c.opened) continue;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function botInput(run) {
  const p = run.player;
  const input = { moveX: 0, moveY: 0, attack: true, dash: false, nova: false, potion: false, autoAttack: false };
  let target = null;
  let best = Infinity;
  let threats = 0;
  let awayX = 0;
  let awayY = 0;
  let incoming = false;
  for (const e of run.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 44) {
      threats++;
      awayX += (dx / d) * (44 - d);
      awayY += (dy / d) * (44 - d);
    }
    if ((e.state === 'windup' && d < 28) || (e.state === 'lunge' && d < 40)) incoming = true;
    if (d < best) {
      best = d;
      target = e;
    }
  }
  const gate = run.pois.filter((g) => g.type === 'gate' && g.open && (!g.toll || run.gold >= run.tollPrice())).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  const goHome = run.timeLeft < 75 && gate;
  let gx = 0;
  let gy = 0;
  if (goHome) {
    const step = pathStep(run, gate);
    gx = step.x;
    gy = step.y;
  } else if (threats < 5 && p.hp > p.stats.maxHp * 0.5 && nearestChest(run, 220)) {
    const chest = nearestChest(run, 220);
    gx = chest.x - p.x;
    gy = chest.y - p.y;
  } else if (target && best < 160) {
    // Hold the edge of weapon reach: step in when far, back off when crowded.
    const want = p.stats.range * 0.8;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    const k = best > want + 6 ? 1 : best < want - 6 ? -1 : 0;
    gx = (dx / l) * k;
    gy = (dy / l) * k;
  } else {
    const chest = run.pois.filter((c) => c.type === 'chest' && !c.opened).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (chest) {
      gx = chest.x - p.x;
      gy = chest.y - p.y;
    }
  }
  // Dodge what a person would see coming: blast circles, arrows and lava.
  let dodgeX = 0;
  let dodgeY = 0;
  for (const r of run.combat.runes) {
    const dx = p.x - r.x;
    const dy = p.y - r.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < r.radius + 8 && r.t > 0.25) {
      dodgeX += (dx / d) * 3;
      dodgeY += (dy / d) * 3;
    }
  }
  for (const a of run.combat.enemyProjectiles) {
    const dx = p.x - a.x;
    const dy = p.y - 6 - a.y;
    const d = Math.hypot(dx, dy);
    const toward = (a.vx * dx + a.vy * dy) / ((Math.hypot(a.vx, a.vy) || 1) * (d || 1));
    if (d < 34 && toward > 0.85) {
      dodgeX += (-a.vy / (Math.hypot(a.vx, a.vy) || 1)) * 3;
      dodgeY += (a.vx / (Math.hypot(a.vx, a.vy) || 1)) * 3;
      if (d < 18) input.dash = true;
    }
  }
  if (run.map.tileAt(p.x, p.y) === 9) {
    for (const [ox, oy] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) {
      if (run.map.tileAt(p.x + ox, p.y + oy) !== 9 && !run.map.isSolidAt(p.x + ox, p.y + oy)) {
        dodgeX += ox / 4;
        dodgeY += oy / 4;
        break;
      }
    }
  }
  const gl = Math.hypot(gx, gy) || 1;
  const awayW = goHome ? 0.008 : 0.06;
  input.moveX = gx / gl + awayX * awayW + dodgeX;
  input.moveY = gy / gl + awayY * awayW + dodgeY;
  // Steer around lava like a person would: pick the closest heading that stays off it.
  const want = Math.atan2(input.moveY, input.moveX);
  const lavaAhead = (a) => run.map.tileAt(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14) === 9;
  if ((input.moveX || input.moveY) && lavaAhead(want)) {
    for (let k = 1; k <= 8; k++) {
      const a = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8);
      if (!lavaAhead(a)) {
        input.moveX = Math.cos(a);
        input.moveY = Math.sin(a);
        break;
      }
    }
  }
  if (incoming) input.dash = true;
  // Jitter to escape getting stuck on walls.
  if (!goHome && Math.floor(run.time * 2) % 9 === 0) {
    input.moveX += Math.sin(run.time * 3) * 0.7;
    input.moveY += Math.cos(run.time * 3) * 0.7;
  }
  input.nova = p.energy >= 50 && threats >= 4;
  input.potion = p.hp < p.stats.maxHp * 0.35;
  return input;
}

const PRIORITY = ['sharpen', 'frenzy', 'vitality', 'ironskin', 'bloodthirst', 'keen', 'executioner', 'regen', 'shadowwave', 'spectral', 'ignite', 'serrated', 'static'];

// The "turtle": stands still, swings at whatever comes, and builds pure sustain.
function turtleInput(run) {
  const p = run.player;
  const gate = run.pois.filter((g) => g.type === 'gate' && g.open && (!g.toll || run.gold >= run.tollPrice())).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (run.timeLeft < 70 && gate) {
    const st = pathStep(run, gate);
    const l = Math.hypot(st.x, st.y) || 1;
    return { moveX: st.x / l, moveY: st.y / l, attack: true, dash: false, nova: p.energy >= 50, potion: p.hp < p.stats.maxHp * 0.35 };
  }
  return { moveX: 0, moveY: 0, attack: true, dash: false, nova: p.energy >= 50, potion: p.hp < p.stats.maxHp * 0.35 };
}
const TURTLE_PRIORITY = ['regen', 'bloodthirst', 'thorns', 'ironskin', 'vitality', 'bulwark', 'sharpen', 'frenzy'];

function handleModal(run) {
  const m = run.modal;
  if (!m) return;
  if (m.kind === 'levelup') {
    const order = style === 'turtle' ? TURTLE_PRIORITY : PRIORITY;
    const idx = m.choices.map((c) => order.indexOf(c.upgrade.id)).map((v) => (v < 0 ? 99 : v));
    run.chooseUpgrade(idx.indexOf(Math.min(...idx)));
  }
  else if (m.kind === 'escape') {
    if (run.timeLeft < 70) run.escape();
    else run.closeModal();
  } else if (m.kind === 'merchant') run.closeModal();
  else if (m.kind === 'event') {
    if (m.result) run.closeModal();
    else run.resolveEvent(m.choices[0].disabled ? 'leave' : m.choices[0].action);
  }
}

const results = [];
for (let i = 0; i < runs; i++) {
  const run = new Run({ seed: 1000 + i, biome, meta, unlocks });
  const dt = 1 / 60;
  let lastMinute = 10;
  const t0 = performance.now();
  let maxEnemies = 0;
  let steps = 0;
  while (!run.ended && steps < 60 * 60 * 12) {
    steps++;
    handleModal(run);
    run.update(dt, style === 'turtle' ? turtleInput(run) : botInput(run));
    maxEnemies = Math.max(maxEnemies, run.enemies.length);
    const minute = Math.ceil(run.timeLeft / 60);
    if (minute < lastMinute) {
      lastMinute = minute;
      const p = run.player;
      console.log(`  seed ${run.seed} ${minute}:00 lvl ${p.level} hp ${Math.round(p.hp)}/${p.stats.maxHp} kills ${run.stats.kills} gold ${Math.round(run.gold)} enemies ${run.enemies.length} dmg ${p.stats.damage.toFixed(1)} weapon ${p.weapon.name} (${p.weapon.rarity}) relics ${p.relics.length}`);
    }
  }
  const r = run.result;
  const ms = performance.now() - t0;
  console.log(`seed ${run.seed}: ${r.outcome} ${r.causeTitle || ''} at ${r.survivalText} lvl ${r.level} kills ${r.kills} elites ${r.elites} gold ${r.goldHeld} score ${r.score} embers ${r.embers.total} best ${r.bestItem ? r.bestItem.rarity + ' ' + r.bestItem.name : '-'} maxEnemies ${maxEnemies} sim ${ms.toFixed(0)}ms`);
  if (r.outcome === "escaped") console.log("   ", r.embers.rows.map((x) => `${x.label}: ${x.value}`).join(" | "), "items", r.items.length, JSON.stringify(r.items.reduce((m, it) => ((m[it.rarity] = (m[it.rarity] || 0) + 1), m), {})));
  results.push(r);
}
const esc = results.filter((r) => r.outcome === 'escaped').length;
const avgT = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
const avgE = results.reduce((s, r) => s + r.embers.total, 0) / results.length;
console.log(`\nescaped ${esc}/${results.length}, avg survival ${(avgT / 60).toFixed(2)} min, avg embers ${avgE.toFixed(0)}`);
