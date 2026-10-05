// Draws a Run to a low-resolution canvas that CSS scales up by an integer
// factor (crisp pixels, cheap on weak phones).

import { TILE, TARGET_VIEW_WIDTH, TARGET_VIEW_HEIGHT_WIDE } from '../data/config.js';
import { PLAYER_HAND } from './art.js';
import { makeCanvas } from './sprites.js';
import { bakeBackground, ellipse } from './background.js';
import { drawText } from './font.js';
import { RARITY_INFO } from '../data/rarities.js';
import { clamp, lerp } from '../core/math.js';
import { T } from '../game/map.js';

const RARITY_GLOW = { common: null, uncommon: 'green', rare: 'blue', epic: 'purple', legendary: 'orange' };

export class Renderer {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.S = sprites;
    this.W = TARGET_VIEW_WIDTH;
    this.H = 320;
    this.scale = 1;
    this.cam = { x: 0, y: 0 };
    this.shake = 0;
    this.quality = 1;
    this.screenShake = true;
    this.light = makeCanvas(this.W, this.H);
    this.lctx = this.light.getContext('2d');
    this.bg = null;
    this.bgFor = null;
    this.drawList = [];
    this.time = 0;
    this.shadows = {};
  }

  resize(cssW, cssH, dpr, wide = false) {
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));
    this.scale = Math.max(1, Math.round(wide ? devH / TARGET_VIEW_HEIGHT_WIDE : devW / TARGET_VIEW_WIDTH));
    this.W = Math.ceil(devW / this.scale);
    this.H = Math.ceil(devH / this.scale);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.canvas.style.width = `${(this.W * this.scale) / dpr}px`;
    this.canvas.style.height = `${(this.H * this.scale) / dpr}px`;
    this.light.width = this.W;
    this.light.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Game-pixels per CSS pixel (used to map screen positions). */
  cssPerPixel(dpr) {
    return this.scale / dpr;
  }

  prepare(run) {
    if (this.bgFor !== run.map) {
      // The town never changes, so keep its baked ground between visits.
      if (run.map.biome.id === 'town') {
        this.townBg = this.townBg && this.townBgFor === run.map ? this.townBg : bakeBackground(run.map, this.S);
        this.townBgFor = run.map;
        this.bg = this.townBg;
      } else this.bg = bakeBackground(run.map, this.S);
      this.bgFor = run.map;
      const p = run.player;
      this.cam.x = p.x - this.W / 2;
      this.cam.y = p.y - this.H * 0.48;
    }
  }

  addShake(amount) {
    if (this.screenShake) this.shake = Math.min(12, this.shake + amount);
  }

  shadow(w) {
    if (!this.shadows[w]) {
      const c = makeCanvas(w * 2 + 2, 6);
      const x = c.getContext('2d');
      x.fillStyle = 'rgba(4, 3, 10, 0.5)';
      ellipse(x, w + 1, 3, w, 2);
      this.shadows[w] = c;
    }
    return this.shadows[w];
  }

  render(run, dt) {
    const ctx = this.ctx;
    const S = this.S;
    const W = this.W;
    const H = this.H;
    this.time += dt;
    this.prepare(run);
    const p = run.player;

    // Camera: follow with a little look-ahead.
    const lookX = p.moving ? Math.cos(p.moveAngle) * 14 : 0;
    const lookY = p.moving ? Math.sin(p.moveAngle) * 10 : 0;
    const tx = clamp(p.x + lookX - W / 2, 0, run.map.size - W);
    const ty = clamp(p.y + lookY - H * 0.48, 0, run.map.size - H);
    const k = 1 - Math.exp(-8 * dt);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
    this.shake *= Math.exp(-9 * dt);
    const sx = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0;
    const cx = Math.round(this.cam.x + sx);
    const cy = Math.round(this.cam.y + sy);
    this.cx = cx;
    this.cy = cy;

    ctx.fillStyle = '#07060c';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(this.bg, cx, cy, W, H, 0, 0, W, H);
    ctx.save();
    ctx.translate(-cx, -cy);

    this.drawGroundLayer(run);
    this.collectDrawables(run);
    for (const d of this.drawList) this.drawItem(run, d);
    this.drawEffects(run);
    ctx.restore();

    if (this.quality) this.drawLighting(run, cx, cy);
    else this.drawVignette();

    ctx.save();
    ctx.translate(-cx, -cy);
    this.drawLabels(run);
    this.drawNumbers(run);
    ctx.restore();
    this.drawEdgeArrows(run, cx, cy);
  }

  inView(x, y, margin = 40) {
    return x > this.cx - margin && x < this.cx + this.W + margin && y > this.cy - margin && y < this.cy + this.H + margin + 20;
  }

  drawGroundLayer(run) {
    const ctx = this.ctx;
    const S = this.S;
    this.drawTerrainFx(run);
    this.drawSpikes(run);
    this.drawRunes(run);
    // Player marker: a soft ring at the feet so you never lose yourself in a crowd.
    const pl = run.player;
    if (!pl.dead) {
      ctx.globalAlpha = 0.35 + Math.sin(this.time * 4) * 0.1;
      ctx.drawImage(S.glow.white, pl.x - 11, pl.y - 6, 22, 10);
      ctx.globalAlpha = 1;
    }
    // Telegraphs drawn on the ground.
    for (const e of run.enemies) {
      if (e.state !== 'windup' || !this.inView(e.x, e.y)) continue;
      if (e.def.behavior === 'melee') {
        // A red wedge shows exactly where the swing will land.
        const prog = 1 - e.timer / e.def.windup;
        const reach = e.def.attackRange + 8;
        const a = Math.atan2(run.player.y - e.y, run.player.x - e.x);
        ctx.fillStyle = `rgba(224, 56, 74, ${0.18 + prog * 0.35})`;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 3);
        ctx.arc(e.x, e.y - 3, reach * (0.4 + prog * 0.6), a - 0.8, a + 0.8);
        ctx.closePath();
        ctx.fill();
      } else if (e.def.behavior === 'archer') {
        // Aim line: where the arrow will fly.
        const prog = 1 - e.timer / e.def.windup;
        ctx.fillStyle = `rgba(255, 90, 90, ${0.3 + prog * 0.5})`;
        for (let i = 8; i < e.def.range; i += 4) ctx.fillRect(Math.round(e.x + e.aimX * i), Math.round(e.y - 7 + e.aimY * i), 1, 1);
      } else if (e.def.behavior === 'lunger') {
        const len = e.def.lungeSpeed * e.def.lungeTime;
        const prog = 1 - e.timer / e.def.lungeWindup;
        ctx.fillStyle = `rgba(224, 56, 74, ${0.25 + prog * 0.45})`;
        for (let i = 6; i < len * Math.min(1, prog * 1.6); i += 3) ctx.fillRect(Math.round(e.x + e.lungeDx * i), Math.round(e.y - 2 + e.lungeDy * i), 1, 1);
      } else if (e.def.behavior === 'champion') {
        const prog = 1 - e.timer / e.def.windup;
        ctx.strokeStyle = 'rgba(224, 56, 74, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y - 2, e.def.slamRadius, e.def.slamRadius * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(224, 56, 74, ${0.12 + prog * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y - 2, e.def.slamRadius * prog, e.def.slamRadius * 0.75 * prog, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Cursed zone mist particles.
    for (const z of run.map.cursedZones) {
      if (!this.inView(z.x, z.y, z.r)) continue;
      if (Math.random() < 0.3) run.effects.particle(z.x + (Math.random() - 0.5) * z.r * 1.6, z.y + (Math.random() - 0.5) * z.r * 1.2, 0, -6, 1.6, Math.random() < 0.5 ? '#7a3fc0' : '#4a2370', 1, -2, 0.5);
    }
    // Gate ground glow.
    for (const poi of run.pois) {
      if ((poi.type !== 'gate' && poi.type !== 'portal') || !this.inView(poi.x, poi.y)) continue;
      if (poi.open) {
        const pulse = 0.5 + Math.sin(this.time * 3) * 0.2;
        ctx.globalAlpha = pulse;
        ctx.drawImage(S.glow.purple, poi.x - 24, poi.y - 10, 48, 20);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Animated terrain: bubbling lava, glinting ice, region weather. */
  drawTerrainFx(run) {
    const ctx = this.ctx;
    const map = run.map;
    const x0 = Math.max(0, Math.floor(this.cx / TILE));
    const y0 = Math.max(0, Math.floor(this.cy / TILE));
    const x1 = Math.min(map.n - 1, Math.floor((this.cx + this.W) / TILE));
    const y1 = Math.min(map.n - 1, Math.floor((this.cy + this.H) / TILE));
    const pal = map.biome.palette;
    if (pal === 'ash' || pal === 'snow') {
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = map.tiles[ty * map.n + tx];
          if (t === T.LAVA) {
            const k = Math.sin(this.time * 2 + tx * 1.3 + ty * 0.7);
            if (k > 0.6) {
              ctx.fillStyle = k > 0.9 ? '#ffd36b' : '#ff9a3c';
              ctx.fillRect(tx * TILE + ((tx * 7 + ty * 3) % 13), ty * TILE + ((tx * 5 + ty * 11) % 13), 2, 1);
            }
            if (Math.random() < 0.003) run.effects.particle(tx * TILE + Math.random() * 16, ty * TILE + Math.random() * 16, 0, -14, 0.8, '#ff9a3c', 1, -6, 0.5);
          } else if (t === T.ICE && Math.sin(this.time * 1.5 + tx * 2.1 + ty) > 0.97) {
            ctx.fillStyle = '#e8f6ff';
            ctx.fillRect(tx * TILE + 5, ty * TILE + 6, 3, 1);
          }
        }
      }
    }
    // Weather / ambient particles.
    const kind = map.biome.particles;
    if (kind && this.quality) {
      const rx = this.cx + Math.random() * this.W;
      const ry = this.cy + Math.random() * this.H;
      if (kind === 'snow' && Math.random() < 0.9) run.effects.particle(rx, this.cy - 4, -8 + Math.random() * 4, 22 + Math.random() * 10, 6, Math.random() < 0.7 ? '#e8eef8' : '#aeb9cf', 1, 0, 0);
      else if (kind === 'ash' && Math.random() < 0.5) run.effects.particle(rx, ry, 4, -8, 3, Math.random() < 0.3 ? '#ff9a3c' : '#5a4a48', 1, -1, 0.2);
      else if (kind === 'fireflies' && Math.random() < 0.06) run.effects.particle(rx, ry, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 2.5, '#d7f06a', 1, 0, 0.1);
      else if (kind === 'dust' && Math.random() < 0.15) run.effects.particle(rx, ry, 2, 1, 3, '#4a4560', 1, 0, 0.1);
    }
  }

  drawSpikes(run) {
    const ctx = this.ctx;
    for (const s of run.map.spikes) {
      if (!this.inView(s.x, s.y, 20)) continue;
      const x = s.tx * TILE;
      const y = s.ty * TILE;
      ctx.fillStyle = '#1a1826';
      ctx.fillRect(x + 1, y + 1, 14, 14);
      for (let k = 0; k < 9; k++) {
        const sx = x + 3 + (k % 3) * 5;
        const sy = y + 3 + Math.floor(k / 3) * 5;
        if (s.state === 'up') {
          ctx.fillStyle = '#c9c6dc';
          ctx.fillRect(sx, sy - 3, 1, 4);
          ctx.fillStyle = '#e0384a';
          ctx.fillRect(sx, sy - 3, 1, 1);
        } else if (s.state === 'warn') {
          ctx.fillStyle = Math.floor(this.time * 12) % 2 ? '#ff5a5a' : '#8a84a6';
          ctx.fillRect(sx, sy - 1, 1, 2);
        } else {
          ctx.fillStyle = '#07060c';
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
  }

  /** Delayed blasts: the ring shows the area, the fill shows the fuse. */
  drawRunes(run) {
    const ctx = this.ctx;
    for (const r of run.combat.runes) {
      if (!this.inView(r.x, r.y, r.radius + 4)) continue;
      const prog = Math.min(1, r.t / r.delay);
      const lava = r.color === 'orange';
      const rgb = lava ? '255,120,40' : '196,140,255';
      ctx.fillStyle = `rgba(${rgb},${0.12 + prog * 0.28})`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.radius * prog, r.radius * 0.7 * prog, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lava ? '#ff9a3c' : '#c48cff';
      const n = Math.round(r.radius * 2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (lava ? 0 : this.time);
        if (!lava && i % 4 === 3) continue;
        ctx.fillRect(Math.round(r.x + Math.cos(a) * r.radius), Math.round(r.y + Math.sin(a) * r.radius * 0.7), 1, 1);
      }
    }
  }

  collectDrawables(run) {
    const list = this.drawList;
    list.length = 0;
    const map = run.map;
    const r0 = clamp(Math.floor(this.cy / TILE) - 1, 0, map.n - 1);
    const r1 = clamp(Math.floor((this.cy + this.H) / TILE) + 3, 0, map.n - 1);
    for (let r = r0; r <= r1; r++) {
      for (const pr of map.propRows[r]) {
        if (pr.x < this.cx - 20 || pr.x > this.cx + this.W + 20) continue;
        list.push({ y: pr.y, kind: 'prop', ref: pr });
      }
    }
    for (const poi of run.pois) if (this.inView(poi.x, poi.y)) list.push({ y: poi.y, kind: 'poi', ref: poi });
    for (const t of map.torches) if (this.inView(t.x, t.y)) list.push({ y: t.y, kind: 'torch', ref: t });
    for (const e of run.enemies) if (this.inView(e.x, e.y)) list.push({ y: e.y, kind: 'enemy', ref: e });
    for (const pk of run.pickups.list) if (this.inView(pk.x, pk.y)) list.push({ y: pk.y - 1, kind: 'pickup', ref: pk });
    list.push({ y: run.player.y, kind: 'player', ref: run.player });
    list.sort((a, b) => a.y - b.y);
  }

  drawItem(run, d) {
    switch (d.kind) {
      case 'prop':
        return this.drawProp(d.ref, run.player);
      case 'poi':
        return this.drawPoi(run, d.ref);
      case 'torch':
        return this.drawTorch(d.ref);
      case 'enemy':
        return this.drawEnemy(run, d.ref);
      case 'pickup':
        return this.drawPickup(run, d.ref);
      case 'player':
        return this.drawPlayer(run, d.ref);
    }
  }

  drawProp(pr, player) {
    const S = this.S;
    let img;
    const set = S.props[pr.kind];
    if (set) img = set[pr.variant % set.length];
    else if (pr.kind === 'pillar') img = S.pillar;
    else if (pr.kind === 'pillarBroken') img = S.pillarBroken;
    else if (S.buildings && S.buildings[pr.kind]) img = S.buildings[pr.kind];
    else return;
    const x = Math.round(pr.x - img.width / 2);
    const y = Math.round(pr.y - img.height + 1);
    // Canopies in front of the player turn see-through so the hero is never lost.
    const hides = pr.y > player.y && player.x > x - 4 && player.x < x + img.width + 4 && player.y - 14 < pr.y && player.y > y + 2;
    if (hides) this.ctx.globalAlpha = 0.45;
    this.ctx.drawImage(img, x, y);
    this.ctx.globalAlpha = 1;
  }

  drawTorch(t) {
    const ctx = this.ctx;
    const x = Math.round(t.x);
    const y = Math.round(t.y);
    ctx.drawImage(this.S.torch, x - 1, y - 6);
    const f = Math.floor(this.time * 10 + t.x) % 3;
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(x - 1, y - 9 + (f === 1 ? 1 : 0), 3, 3);
    ctx.fillStyle = '#ffd36b';
    ctx.fillRect(x, y - 10 + f % 2, 1, 2);
  }

  drawPoi(run, poi) {
    const ctx = this.ctx;
    const S = this.S;
    const x = Math.round(poi.x);
    const y = Math.round(poi.y);
    switch (poi.type) {
      case 'chest': {
        const img = poi.opened ? S.chestOpen[poi.rarity] : S.chest[poi.rarity];
        const glow = RARITY_GLOW[poi.rarity];
        if (!poi.opened && glow) {
          ctx.globalAlpha = 0.55 + Math.sin(this.time * 4 + x) * 0.2;
          ctx.drawImage(S.glow[glow], x - 14, y - 16, 28, 24);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(this.shadow(7), x - 8, y - 3);
        ctx.drawImage(img, x - 7, y - 11);
        if (!poi.opened && Math.random() < 0.04) run.effects.particle(x + (Math.random() - 0.5) * 12, y - 8 - Math.random() * 4, 0, -10, 0.6, RARITY_INFO[poi.rarity].color, 1, 0, 1);
        break;
      }
      case 'mystery': {
        const img = poi.used ? S.chestMysteryOpen : S.chestMystery;
        if (!poi.used) {
          ctx.globalAlpha = 0.6 + Math.sin(this.time * 3) * 0.25;
          ctx.drawImage(S.glow.purple, x - 16, y - 18, 32, 28);
          ctx.globalAlpha = 1;
          drawText(ctx, '?', x, y - 22 + Math.round(Math.sin(this.time * 3) * 1.5), '#d7a8ff');
        }
        ctx.drawImage(this.shadow(7), x - 8, y - 3);
        ctx.drawImage(img, x - 7, y - 11);
        break;
      }
      case 'shrine': {
        const img = poi.used ? S.shrine.spent : S.shrine[poi.kind];
        if (!poi.used) {
          const color = { blood: 'red', greed: 'gold', fortune: 'purple', haste: 'blue' }[poi.kind];
          ctx.globalAlpha = 0.5 + Math.sin(this.time * 2.5) * 0.25;
          ctx.drawImage(S.glow[color], x - 14, y - 26, 28, 28);
          ctx.globalAlpha = 1;
        }
        ctx.drawImage(this.shadow(7), x - 8, y - 3);
        ctx.drawImage(img, x - 7, y - 16);
        break;
      }
      case 'merchant': {
        ctx.drawImage(this.shadow(6), x - 7, y - 3);
        ctx.drawImage(S.merchant.r, x - 8, y - 15 + (Math.floor(this.time * 2) % 2));
        drawText(ctx, '$', x, y - 24 + Math.round(Math.sin(this.time * 3)), '#ffd36b');
        break;
      }
      case 'gate':
      case 'portal':
        this.drawGate(run, poi, x, y);
        break;
      case 'vendor': {
        const npc = S.npc[poi.shop] || S.merchant;
        ctx.drawImage(this.shadow(6), x - 7, y - 3);
        const facing = run.player.x < x ? npc.l : npc.r;
        ctx.drawImage(facing, x - 8, y - 15 + (Math.floor(this.time * 2 + x) % 2));
        break;
      }
      case 'board':
        ctx.drawImage(S.noticeBoard, x - 9, y - 18);
        break;
      case 'camp': {
        // Campfire.
        ctx.fillStyle = '#3b2618';
        ctx.fillRect(x - 4, y + 6, 9, 2);
        ctx.fillStyle = '#6e4a2c';
        ctx.fillRect(x - 3, y + 5, 7, 1);
        const f = Math.floor(this.time * 9) % 3;
        ctx.fillStyle = '#c2561f';
        ctx.fillRect(x - 2, y + 1 + (f === 0 ? 1 : 0), 5, 4);
        ctx.fillStyle = '#ff9a3c';
        ctx.fillRect(x - 1, y + f % 2, 3, 4);
        ctx.fillStyle = '#ffd36b';
        ctx.fillRect(x, y + 2, 1, 2);
        if (Math.random() < 0.15) run.effects.particle(x + (Math.random() - 0.5) * 4, y, (Math.random() - 0.5) * 6, -18, 0.8, '#ff9a3c', 1, 0, 0.5);
        break;
      }
    }
  }

  drawGate(run, poi, x, y) {
    const ctx = this.ctx;
    const S = this.S;
    // Stone frame.
    ctx.drawImage(S.pillar, x - 19, y - 14);
    ctx.drawImage(S.pillar, x + 11, y - 14);
    const cy = y - 13;
    if (!poi.open) {
      ctx.fillStyle = '#241e33';
      for (let a = 0; a < Math.PI * 2; a += 0.35) ctx.fillRect(Math.round(x + Math.cos(a) * 8), Math.round(cy + Math.sin(a) * 12), 1, 1);
      return;
    }
    const flicker = poi.closing && Math.floor(this.time * 8) % 2 === 0;
    // Dark core.
    ctx.fillStyle = flicker ? '#2a0a12' : '#120720';
    ctx.beginPath();
    ctx.ellipse(x, cy, 8, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Swirling ring.
    const ring = flicker ? ['#e0384a', '#8e1f2c'] : ['#b68cff', '#7a3fc0', '#f4f2ff'];
    for (let i = 0; i < 28; i++) {
      const a = this.time * 2.2 + (i / 28) * Math.PI * 2;
      const r = 1 - (i % 3) * 0.12;
      ctx.fillStyle = ring[i % ring.length];
      ctx.fillRect(Math.round(x + Math.cos(a) * 8 * r), Math.round(cy + Math.sin(a) * 12 * r), 1, 1);
    }
    for (let i = 0; i < 8; i++) {
      const a = -this.time * 3 + (i / 8) * Math.PI * 2;
      const r = 3 + Math.sin(this.time * 2 + i) * 2;
      ctx.fillStyle = '#7a3fc0';
      ctx.fillRect(Math.round(x + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 1.4), 1, 1);
    }
    if (Math.random() < 0.3) run.effects.particle(x + (Math.random() - 0.5) * 16, cy + (Math.random() - 0.5) * 22, 0, -14, 0.7, '#b68cff', 1, 0, 0.5);
  }

  drawEnemy(run, e) {
    const ctx = this.ctx;
    const S = this.S;
    const scale = e.def.scale || 1;
    const frames = S.enemyFrames(e.def.sprite, e.champion ? 'champion' : run.biome.skin, e.elite && !e.champion);

    let fi = Math.floor(e.animT * 5) % 2;
    if (e.state === 'windup' && frames.length > 2) fi = 2;
    if (e.def.behavior === 'lunger' && e.state === 'lunge') fi = 1;
    const b = frames[Math.min(fi, frames.length - 1)];
    const flashing = e.flash > 0;
    const img = flashing ? (e.facing < 0 ? b.flashL : b.flashR) : e.facing < 0 ? b.l : b.r;
    let w = b.w * scale;
    let h = b.h * scale;
    let yOff = 0;

    if (e.def.behavior === 'hopper') {
      if (e.state === 'hop') {
        const t = 1 - e.timer / e.def.hopTime;
        yOff = -Math.sin(t * Math.PI) * 5;
        w = Math.round(b.w * 0.88);
        h = Math.round(b.h * 1.12);
      } else {
        const squash = Math.max(0, Math.sin(e.animT * 6)) * 0.12;
        w = Math.round(b.w * (1 + squash));
        h = Math.round(b.h * (1 - squash));
      }
    }

    const x = Math.round(e.x);
    const y = Math.round(e.y);
    // Spawn: rise out of the ground.
    let alpha = 1;
    if (e.spawnT > 0) alpha = clamp(1 - e.spawnT / 0.35, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.shadow(Math.round(e.radius * scale * 0.9 + 2)), x - Math.round(e.radius * scale * 0.9 + 3), y - 3);
    if (e.elite || e.cursed) {
      ctx.globalAlpha = alpha * (0.55 + Math.sin(this.time * 5 + e.id) * 0.2);
      const gs = 18 * scale;
      ctx.drawImage(S.glow[e.champion ? 'red' : 'purple'], x - gs / 2, y - h / 2 - gs / 2 - 2, gs, gs);
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h + 1 + yOff), w, h);
    ctx.globalAlpha = 1;

    if (e.elite && !e.champion && Math.random() < 0.12) run.effects.particle(x + (Math.random() - 0.5) * w, y - Math.random() * h, 0, -12, 0.5, '#b68cff', 1, 0, 0.5);

    // Telegraph mark.
    if (e.state === 'windup' && e.def.behavior === 'melee') {
      drawText(ctx, '!', x, y - h - 6, Math.floor(this.time * 12) % 2 ? '#ff5a5a' : '#ffd36b');
    }
    // HP bar for damaged or elite foes.
    if (!e.champion && (e.hp < e.maxHp || e.elite)) {
      const bw = e.elite ? 14 : 10;
      const bx = x - bw / 2;
      const by = y - h - 2;
      ctx.fillStyle = '#07060c';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 3);
      ctx.fillStyle = e.elite ? '#b68cff' : '#e0384a';
      ctx.fillRect(bx, by, Math.max(1, Math.round((bw * e.hp) / e.maxHp)), 1);
    }
  }

  drawPickup(run, pk) {
    const ctx = this.ctx;
    const S = this.S;
    const x = Math.round(pk.x);
    const y = Math.round(pk.y - pk.z);
    if (pk.kind === 'gold') {
      const img = S.coin[Math.floor(this.time * 6 + pk.x) % 2];
      ctx.drawImage(img, x - 2, y - 4);
    } else if (pk.kind === 'xp') {
      const img = pk.big ? S.shardBig : S.shard;
      ctx.drawImage(img, x - Math.floor(img.width / 2), y - img.height + Math.round(Math.sin(this.time * 4 + pk.x) * 0.8));
    } else {
      const item = pk.item;
      const glow = RARITY_GLOW[item.rarity];
      const bob = Math.round(Math.sin(this.time * 3 + pk.x) * 1.5);
      if (glow) {
        ctx.globalAlpha = 0.6 + Math.sin(this.time * 4) * 0.2;
        ctx.drawImage(S.glow[glow], x - 12, y - 16, 24, 24);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(this.shadow(4), x - 5, Math.round(pk.y) - 3);
      let img;
      if (item.kind === 'weapon') img = S.weaponIcons[`${item.type}|${item.rarity}`];
      else if (item.kind === 'relic' || item.kind === 'armor') img = S.icon(item.icon, item.rarity);
      else img = S.potion;
      ctx.drawImage(img, x - Math.floor(img.width / 2), y - img.height - 2 + bob);
    }
  }

  drawPlayer(run, p) {
    const ctx = this.ctx;
    const S = this.S;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (p.dead && run.ended && run.result && run.result.outcome === 'escaped') return;
    ctx.drawImage(this.shadow(5), x - 6, y - 3);
    const b = S.playerSprites(p.gear)[p.currentSpriteName()];
    const blink = p.iframes > 0 && p.dashT <= 0 && Math.floor(this.time * 20) % 2 === 0;
    const flash = p.hurtFlash > 0;
    const img = flash ? (p.facing < 0 ? b.flashL : b.flashR) : p.facing < 0 ? b.l : b.r;
    const bob = !p.moving && Math.floor(this.time * 2) % 2 === 0 ? 1 : 0;
    if (p.shield > 0) {
      ctx.globalAlpha = 0.5;
      ctx.drawImage(S.glow.blue, x - 12, y - 20, 24, 24);
      ctx.globalAlpha = 1;
    }
    if (blink) ctx.globalAlpha = 0.45;
    ctx.drawImage(img, x - 8, y - 15 + bob);
    ctx.globalAlpha = 1;

    // Overhead HP bar when hurt, so you can read your health without looking away.
    const hpPct = p.hp / p.stats.maxHp;
    if (hpPct < 0.999 && !p.dead) {
      ctx.fillStyle = '#07060c';
      ctx.fillRect(x - 8, y - 21, 16, 3);
      ctx.fillStyle = hpPct < 0.3 ? (Math.floor(this.time * 6) % 2 ? '#ff5a5a' : '#8e1f2c') : '#e0384a';
      ctx.fillRect(x - 7, y - 20, Math.max(1, Math.round(14 * hpPct)), 1);
    }
    if (run.frost > 2) {
      ctx.globalAlpha = Math.min(0.6, (run.frost - 2) * 0.25);
      ctx.drawImage(S.glow.blue, x - 12, y - 20, 24, 24);
      ctx.globalAlpha = 1;
    }
    // Weapon.
    const wpn = S.weapons[p.weapon.sprite][p.weapon.rarity];
    const hx = p.facing > 0 ? x - 8 + PLAYER_HAND.x : x + 8 - PLAYER_HAND.x - 1;
    const hy = y - 15 + PLAYER_HAND.y + bob;
    let angle;
    if (p.swingT > 0) {
      const t = 1 - p.swingT / 0.14;
      const e = 1 - Math.pow(1 - t, 3);
      const arc = p.stats.arc;
      angle = p.aimAngle + p.swingDir * (-arc / 2 + arc * e);
    } else {
      angle = p.facing > 0 ? 0.9 : Math.PI - 0.9;
    }
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(angle);
    ctx.drawImage(wpn.img, -Math.round(wpn.pivot[0]), -Math.round(wpn.pivot[1]));
    ctx.restore();

    // Orbiting spectral blades.
    const n = p.stats.raw.orbitBlades;
    if (n > 0) {
      const r = 22 * (1 + p.stats.raw.areaPct * 0.4);
      for (let i = 0; i < n; i++) {
        const a = p.orbitAngle + (i * Math.PI * 2) / n;
        const bx = p.x + Math.cos(a) * r;
        const by = p.y - 4 + Math.sin(a) * r;
        ctx.save();
        ctx.translate(Math.round(bx), Math.round(by));
        ctx.rotate(a + Math.PI / 2);
        ctx.globalAlpha = 0.85;
        ctx.drawImage(S.weapons.dagger.epic.img, -4, -2);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
  }

  drawEffects(run) {
    const ctx = this.ctx;
    const fx = run.effects;
    const S = this.S;
    // Afterimages.
    for (const a of fx.afterimages) {
      const b = S[a.sprite] || S.player_idle;
      ctx.globalAlpha = (a.life / a.max) * 0.45;
      ctx.drawImage(a.flip ? b.flashL : b.flashR, Math.round(a.x - 8), Math.round(a.y - 15));
    }
    ctx.globalAlpha = 1;
    // Loot beams.
    for (const bm of fx.beams) {
      const t = bm.life / bm.max;
      const h = 70;
      const col = bm.color === 'orange' ? '255,171,64' : '196,140,255';
      ctx.fillStyle = `rgba(${col},${0.35 * t})`;
      ctx.fillRect(Math.round(bm.x - 3), Math.round(bm.y - h), 6, h);
      ctx.fillStyle = `rgba(255,255,255,${0.5 * t})`;
      ctx.fillRect(Math.round(bm.x - 1), Math.round(bm.y - h), 2, h);
    }
    // Slashes: a crescent of pixels sweeping along the arc.
    for (const s of fx.slashes) {
      const t = 1 - s.life / s.max;
      const sweep = Math.min(1, t * 1.6);
      const start = s.angle - (s.dir * s.arc) / 2;
      const steps = Math.ceil(s.range * s.arc * 0.5);
      ctx.fillStyle = s.color;
      ctx.globalAlpha = 1 - t * 0.7;
      for (let i = 0; i <= steps * sweep; i++) {
        const a = start + (s.dir * s.arc * i) / steps;
        const thick = Math.sin((i / steps) * Math.PI) * 3;
        for (let r = s.range - thick; r <= s.range; r += 1) {
          ctx.fillRect(Math.round(s.x + Math.cos(a) * r), Math.round(s.y + Math.sin(a) * r), 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }
    // Enemy arrows.
    for (const pr of run.combat.enemyProjectiles) {
      const len = 6;
      const l = Math.hypot(pr.vx, pr.vy) || 1;
      const dx = pr.vx / l;
      const dy = pr.vy / l;
      ctx.fillStyle = '#d9d2bf';
      for (let i = 0; i < len; i++) ctx.fillRect(Math.round(pr.x - dx * i), Math.round(pr.y - dy * i), 1, 1);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillRect(Math.round(pr.x), Math.round(pr.y), 1, 1);
    }
    // Shadow-wave projectiles.
    for (const pr of run.combat.projectiles) {
      ctx.fillStyle = '#b68cff';
      for (let i = -4; i <= 4; i++) {
        const a = pr.angle + Math.PI / 2;
        const bend = Math.abs(i) * 0.6;
        ctx.fillRect(Math.round(pr.x + Math.cos(a) * i - Math.cos(pr.angle) * bend), Math.round(pr.y + Math.sin(a) * i - Math.sin(pr.angle) * bend), 2, 2);
      }
      ctx.fillStyle = '#f4f2ff';
      ctx.fillRect(Math.round(pr.x), Math.round(pr.y), 1, 1);
    }
    // Rings.
    for (const r of fx.rings) {
      const t = 1 - r.life / r.max;
      const rad = r.radius * (0.3 + t * 0.7);
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = r.color;
      const n = Math.max(16, Math.round(rad * 2.4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ctx.fillRect(Math.round(r.x + Math.cos(a) * rad), Math.round(r.y + Math.sin(a) * rad * 0.8), r.width, 1);
      }
      ctx.globalAlpha = 1;
    }
    // Lightning.
    for (const b of fx.bolts) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = b.life / b.max + 0.3;
      ctx.beginPath();
      for (let i = 0; i < b.points.length - 1; i++) {
        const [x0, y0] = b.points[i];
        const [x1, y1] = b.points[i + 1];
        ctx.moveTo(x0, y0);
        const segs = 4;
        for (let j = 1; j <= segs; j++) {
          const t = j / segs;
          const jx = j === segs ? 0 : (Math.random() - 0.5) * 6;
          const jy = j === segs ? 0 : (Math.random() - 0.5) * 6;
          ctx.lineTo(x0 + (x1 - x0) * t + jx, y0 + (y1 - y0) * t + jy);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Particles.
    for (const pt of fx.particles) {
      ctx.globalAlpha = Math.min(1, (pt.life / pt.max) * 1.5);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  drawLighting(run, cx, cy) {
    const lctx = this.lctx;
    const S = this.S;
    const W = this.W;
    const H = this.H;
    const p = run.player;
    let dark = run.phase.darkness + (run.biome ? run.biome.darkness : 0);
    if (run.timeLeft <= 60) dark += 0.06 + Math.sin(this.time * 4) * 0.03;
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, W, H);
    lctx.fillStyle = `rgba(8, 4, 20, ${dark})`;
    lctx.fillRect(0, 0, W, H);
    lctx.globalCompositeOperation = 'destination-out';
    const light = (x, y, r, a = 1) => {
      const sx = x - cx;
      const sy = y - cy;
      if (sx < -r || sy < -r || sx > W + r || sy > H + r) return;
      lctx.globalAlpha = a;
      lctx.drawImage(S.light, sx - r, sy - r, r * 2, r * 2);
    };
    const flick = 0.92 + Math.sin(this.time * 13) * 0.04 + Math.sin(this.time * 7.3) * 0.04;
    light(p.x, p.y - 6, p.stats.lightRadius * (run.timeLeft <= 60 ? 0.9 : 1), 1);
    for (const t of run.map.torches) light(t.x, t.y - 8, 34 * flick, 0.9);
    for (const poi of run.pois) {
      if ((poi.type === 'gate' || poi.type === 'portal') && poi.open) light(poi.x, poi.y - 12, 46, 1);
      else if (poi.type === 'vendor') light(poi.x, poi.y - 8, 30, 0.8);
      else if (poi.type === 'merchant') light(poi.x, poi.y - 8, 34, 0.9);
      else if (poi.type === 'camp') light(poi.x, poi.y, 40 * flick, 1);
      else if (poi.type === 'chest' && !poi.opened && RARITY_INFO[poi.rarity].tier >= 2) light(poi.x, poi.y - 6, 20, 0.6);
      else if (poi.type === 'shrine' && !poi.used) light(poi.x, poi.y - 12, 24, 0.7);
      else if (poi.type === 'mystery' && !poi.used) light(poi.x, poi.y - 6, 22, 0.7);
    }
    for (const bm of run.effects.beams) light(bm.x, bm.y - 20, 30, bm.life / bm.max);
    for (const r of run.combat.runes) light(r.x, r.y, r.radius + 8, 0.5 + 0.5 * Math.min(1, r.t / r.delay));
    if (run.map.biome.palette === 'ash') {
      const map = run.map;
      const x0 = Math.max(0, Math.floor(cx / TILE) - 1);
      const y0 = Math.max(0, Math.floor(cy / TILE) - 1);
      const x1 = Math.min(map.n - 1, Math.floor((cx + W) / TILE) + 1);
      const y1 = Math.min(map.n - 1, Math.floor((cy + H) / TILE) + 1);
      for (let ty = y0; ty <= y1; ty += 2)
        for (let tx = x0; tx <= x1; tx += 2) if (map.tiles[ty * map.n + tx] === T.LAVA) light(tx * TILE + 8, ty * TILE + 8, 26, 0.35);
    }
    for (const r of run.effects.rings) light(r.x, r.y, r.radius, (r.life / r.max) * 0.8);
    for (const pr of run.combat.projectiles) light(pr.x, pr.y, 16, 0.6);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(this.light, 0, 0);

    // Colored glows on top.
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.22 * flick;
    for (const t of run.map.torches) {
      const sx = t.x - cx;
      const sy = t.y - cy;
      if (sx > -30 && sy > -30 && sx < W + 30 && sy < H + 30) ctx.drawImage(S.glow.orange, sx - 20, sy - 28, 40, 40);
    }
    ctx.globalAlpha = 0.25;
    for (const poi of run.pois) {
      if ((poi.type === 'gate' || poi.type === 'portal') && poi.open) ctx.drawImage(S.glow.purple, poi.x - cx - 26, poi.y - cy - 40, 52, 52);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawVignette() {
    if (!this.vignette || this.vignette.width !== this.W || this.vignette.height !== this.H) {
      this.vignette = makeCanvas(this.W, this.H);
      const v = this.vignette.getContext('2d');
      const g = v.createRadialGradient(this.W / 2, this.H / 2, this.H * 0.25, this.W / 2, this.H / 2, this.H * 0.7);
      g.addColorStop(0, 'rgba(8,4,20,0)');
      g.addColorStop(1, 'rgba(8,4,20,0.55)');
      v.fillStyle = g;
      v.fillRect(0, 0, this.W, this.H);
    }
    this.ctx.drawImage(this.vignette, 0, 0);
  }

  /** Name tags on nearby points of interest so it's clear what everything is. */
  drawLabels(run) {
    const ctx = this.ctx;
    const p = run.player;
    const range = run.biome && run.biome.id === 'town' ? 400 : 95;
    for (const poi of run.pois) {
      if (!poi.discovered) continue;
      const d2 = (poi.x - p.x) ** 2 + (poi.y - p.y) ** 2;
      if (d2 > range * range) continue;
      let label = null;
      let color = '#c9c6dc';
      let lift = 20;
      if (poi.type === 'gate') {
        label = poi.open ? 'RIFT GATE' : 'COLLAPSED';
        color = poi.open ? '#d7b8ff' : '#6d6588';
        lift = 36;
      } else if (poi.type === 'chest' && !poi.opened) {
        label = poi.cursed ? 'CURSED CHEST' : poi.treasure ? 'TREASURE' : 'CHEST';
        color = RARITY_INFO[poi.rarity].color;
        lift = 20;
      } else if (poi.type === 'shrine' && !poi.used) {
        label = 'SHRINE';
        color = '#ff9a9a';
        lift = 26;
      } else if (poi.type === 'mystery' && !poi.used) {
        label = 'MYSTERY';
        color = '#d7a8ff';
        lift = 30;
      } else if (poi.type === 'merchant') {
        label = 'MERCHANT';
        color = '#ffd36b';
        lift = 32;
      } else if (poi.type === 'vendor') {
        label = poi.label;
        color = poi.color || '#ffd36b';
        lift = 30;
      } else if (poi.type === 'board') {
        label = 'RECORDS';
        color = '#c9c6dc';
        lift = 24;
      } else if (poi.type === 'portal') {
        label = 'RIFT PORTAL';
        color = '#d7b8ff';
        lift = 40;
      }
      if (!label) continue;
      ctx.globalAlpha = range < 100 && d2 > 70 * 70 ? 0.55 : 1;
      drawText(ctx, label, Math.round(poi.x), Math.round(poi.y - lift), color);
    }
    ctx.globalAlpha = 1;
  }

  drawNumbers(run) {
    const ctx = this.ctx;
    for (const n of run.effects.numbers) {
      ctx.globalAlpha = Math.min(1, (n.life / n.max) * 2);
      drawText(ctx, n.text, n.x, n.y, n.color, n.scale);
    }
    for (const t of run.effects.texts) {
      ctx.globalAlpha = Math.min(1, (t.life / t.max) * 2);
      drawText(ctx, t.text, t.x, t.y, t.color, t.scale);
    }
    ctx.globalAlpha = 1;
  }

  /** Arrows at the screen edge pointing to the nearest open gate, merchants and the champion. */
  drawEdgeArrows(run, cx, cy) {
    const ctx = this.ctx;
    const p = run.player;
    const targets = [];
    let gate = null;
    let gd = Infinity;
    for (const poi of run.pois) {
      if (poi.type === 'gate' && poi.open) {
        const d = (poi.x - p.x) ** 2 + (poi.y - p.y) ** 2;
        if (d < gd) {
          gd = d;
          gate = poi;
        }
      } else if (poi.type === 'merchant') targets.push({ x: poi.x, y: poi.y - 8, color: '#ffd36b', label: '$' });
    }
    if (gate) targets.push({ x: gate.x, y: gate.y - 12, color: run.timeLeft <= 60 && Math.floor(this.time * 4) % 2 ? '#f4f2ff' : '#b68cff', label: 'G', gate: true });
    if (run.championRef && !run.championRef.dead) targets.push({ x: run.championRef.x, y: run.championRef.y - 16, color: '#ff5a5a', label: '!' });

    const W = this.W;
    const H = this.H;
    const top = this.safeTop || 18;
    const bottom = this.safeBottom || 10;
    for (const t of targets) {
      const sx = t.x - cx;
      const sy = t.y - cy;
      if (sx > 4 && sx < W - 4 && sy > top && sy < H - bottom) continue;
      const ox = W / 2;
      const oy = (top + H - bottom) / 2;
      const dx = sx - ox;
      const dy = sy - oy;
      const halfW = W / 2 - 8;
      const halfH = (H - bottom - top) / 2 - 8;
      const s = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
      const ax = ox + dx * s;
      const ay = oy + dy * s;
      const ang = Math.atan2(dy, dx);
      ctx.fillStyle = '#07060c';
      ctx.fillRect(Math.round(ax) - 4, Math.round(ay) - 4, 9, 9);
      ctx.fillStyle = t.color;
      for (let i = 0; i < 4; i++) {
        const bx = ax + Math.cos(ang) * (2 + i);
        const by = ay + Math.sin(ang) * (2 + i);
        const w = 4 - i;
        for (let j = -w; j <= w; j++) ctx.fillRect(Math.round(bx + Math.cos(ang + Math.PI / 2) * j * 0.5), Math.round(by + Math.sin(ang + Math.PI / 2) * j * 0.5), 1, 1);
      }
      drawText(ctx, t.label, Math.round(ax - Math.cos(ang) * 1), Math.round(ay - 2), t.color);
      if (t.gate) {
        const meters = Math.round(Math.hypot(t.x - p.x, t.y - p.y) / 8);
        drawText(ctx, `${meters}M`, Math.round(clamp(ax - Math.cos(ang) * 14, 10, W - 10)), Math.round(clamp(ay - Math.sin(ang) * 12 - 2, top + 2, H - bottom - 8)), t.color);
      }
    }
  }
}
