// Animated pixel-art vista behind the title, camp and results screens:
// a ruined skyline under the eclipse, with a lone wanderer on a cliff.

import { makeCanvas, bake, silhouette } from '../gfx/sprites.js';
import { ART } from '../gfx/art.js';
import { RNG } from '../core/rng.js';

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function hex(c) {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export class HubScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.t = 0;
    this.embers = [];
    this.raf = 0;
  }

  resize(cssW, cssH) {
    // Keep pixels square in either orientation: the short side is fixed.
    const wide = cssW > cssH;
    const W = wide ? Math.round((cssW / cssH) * 136) : 128;
    const H = wide ? 136 : Math.max(160, Math.round((cssH / cssW) * W));
    if (this.W === W && this.H === H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.bake();
  }

  bake() {
    const { W, H } = this;
    const rng = new RNG(77);
    const base = makeCanvas(W, H);
    const ctx = base.getContext('2d');
    const img = ctx.createImageData(W, H);
    const stops = [hex('#06040c'), hex('#140a26'), hex('#2d1446'), hex('#4c1f5c'), hex('#6e2c5c')];
    const horizon = H * 0.62;
    for (let y = 0; y < H; y++) {
      const t = Math.min(1, y / horizon) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i;
      for (let x = 0; x < W; x++) {
        const thr = (BAYER[y % 4][x % 4] + 0.5) / 16;
        const c = f > thr ? stops[i + 1] : stops[i];
        const o = (y * W + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Eclipse with corona.
    const ex = Math.round(W * 0.7);
    const ey = Math.round(H * 0.2);
    this.eclipse = { x: ex, y: ey };
    for (let r = 26; r > 13; r--) {
      ctx.fillStyle = `rgba(182, 140, 255, ${0.05 + (26 - r) * 0.012})`;
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#d7b8ff';
    ctx.beginPath();
    ctx.arc(ex, ey, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#05030a';
    ctx.beginPath();
    ctx.arc(ex, ey, 12, 0, Math.PI * 2);
    ctx.fill();

    // Cloud streaks.
    ctx.fillStyle = 'rgba(20, 10, 34, 0.7)';
    for (let i = 0; i < 9; i++) {
      const y = rng.int(Math.round(H * 0.08), Math.round(H * 0.5));
      ctx.fillRect(rng.int(-20, W), y, rng.int(20, 60), rng.chance(0.5) ? 1 : 2);
    }

    // Far castle skyline.
    const skyline = (color, baseY, count, minH, maxH, windows) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, baseY, W, H - baseY);
      let x = -4;
      for (let i = 0; i < count && x < W + 4; i++) {
        const w = rng.int(5, 12);
        const h = rng.int(minH, maxH);
        ctx.fillRect(x, baseY - h, w, h);
        // spire
        const sx = x + Math.floor(w / 2);
        for (let k = 0; k < rng.int(3, 8); k++) ctx.fillRect(sx - Math.max(0, Math.floor((w / 2) * (1 - k / 6))), baseY - h - k, Math.max(1, Math.floor(w * (1 - k / 6))), 1);
        if (rng.chance(0.4)) ctx.fillRect(x - 2, baseY - Math.floor(h * 0.6), 2, Math.floor(h * 0.6));
        if (windows) {
          for (let k = 0; k < 3; k++) {
            if (!rng.chance(0.45)) continue;
            ctx.fillStyle = rng.chance(0.7) ? '#ff9a3c' : '#ffd36b';
            ctx.fillRect(x + rng.int(1, Math.max(1, w - 2)), baseY - rng.int(3, h - 2), 1, 1);
            ctx.fillStyle = color;
          }
        }
        x += w + rng.int(-2, 6);
      }
    };
    skyline('#1e1032', Math.round(H * 0.6), 18, 8, 30, false);
    skyline('#130a22', Math.round(H * 0.68), 14, 6, 40, true);
    // Rolling hills.
    ctx.fillStyle = '#0c0716';
    for (let x = 0; x < W; x++) {
      const y = Math.round(H * 0.74 + Math.sin(x * 0.07) * 3 + Math.sin(x * 0.19) * 2);
      ctx.fillRect(x, y, 1, H - y);
    }
    // Cliff in the foreground (left).
    ctx.fillStyle = '#07040d';
    for (let x = 0; x < W; x++) {
      const edge = W * 0.52;
      const y = x < edge ? Math.round(H * 0.79 - Math.sin((x / edge) * Math.PI * 0.5) * 6 + (rng.chance(0.3) ? 1 : 0)) : Math.round(H * 0.79 + (x - edge) * 0.9);
      ctx.fillRect(x, y, 1, H - y);
    }
    // Rim light on the cliff edge.
    ctx.fillStyle = '#3a1f52';
    for (let x = 0; x < W * 0.52; x++) {
      const y = Math.round(H * 0.79 - Math.sin((x / (W * 0.52)) * Math.PI * 0.5) * 6);
      if (rng.chance(0.6)) ctx.fillRect(x, y, 1, 1);
    }

    // The wanderer, seen as a silhouette with a violet rim.
    const dark = '#05030a';
    const swap = { 0: dark, 1: dark, 2: '#0b0714', 3: '#120b1e', 4: '#160e24', 5: dark, s: dark, S: dark, q: '#2a1440', p: dark, 6: '#6d6588', 7: '#a49cbd', O: '#c2561f' };
    const hero = bake(ART.player_idle, swap);
    const rim = silhouette(hero, '#5b2a96');
    const hx = Math.round(W * 0.36);
    const hy = Math.round(H * 0.79 - 6 - 30);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rim, hx + 1, hy - 1, 32, 32);
    ctx.drawImage(hero, hx, hy, 32, 32);
    // Sword planted at the side.
    ctx.fillStyle = dark;
    ctx.fillRect(hx + 31, hy + 10, 2, 22);
    ctx.fillRect(hx + 28, hy + 13, 8, 2);
    ctx.fillStyle = '#8a84a6';
    ctx.fillRect(hx + 32, hy + 16, 1, 15);
    ctx.fillStyle = '#ff9a3c';
    ctx.fillRect(hx + 31, hy + 12, 2, 1);

    this.base = base;
    this.stars = Array.from({ length: 40 }, () => ({ x: rng.int(0, W - 1), y: rng.int(0, Math.round(H * 0.45)), p: rng.range(0, 6), c: rng.chance(0.25) ? '#c48cff' : '#e8e4f4' }));
    this.embers = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.canvas.classList.remove('hidden');
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.canvas.classList.add('hidden');
  }

  draw(dt) {
    if (!this.base) return;
    const { ctx, W, H } = this;
    this.t += dt;
    ctx.drawImage(this.base, 0, 0);
    for (const s of this.stars) {
      if (Math.sin(this.t * 2 + s.p) > -0.3) {
        ctx.fillStyle = s.c;
        ctx.fillRect(s.x, s.y, 1, 1);
      }
    }
    // Eclipse pulse.
    const e = this.eclipse;
    ctx.fillStyle = `rgba(196, 140, 255, ${0.15 + Math.sin(this.t * 1.5) * 0.08})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, 16, 0, Math.PI * 2);
    ctx.arc(e.x, e.y, 13, 0, Math.PI * 2, true);
    ctx.fill();
    // Drifting fog.
    for (let i = 0; i < 3; i++) {
      const y = Math.round(H * (0.66 + i * 0.05));
      const x = ((this.t * (4 + i * 3)) % (W + 60)) - 60;
      ctx.fillStyle = `rgba(110, 50, 150, ${0.12 - i * 0.02})`;
      ctx.fillRect(Math.round(x), y, 60, 2);
      ctx.fillRect(Math.round(x + 70 - W), y + 1, 50, 2);
    }
    // Rising embers.
    if (Math.random() < dt * 12) this.embers.push({ x: Math.random() * W, y: H + 2, vx: (Math.random() - 0.5) * 6, vy: -8 - Math.random() * 10, life: 4 + Math.random() * 3 });
    for (const m of this.embers) {
      m.life -= dt;
      m.x += (m.vx + Math.sin(this.t * 2 + m.y * 0.1) * 3) * dt;
      m.y += m.vy * dt;
      ctx.fillStyle = m.life > 2 ? '#ff9a3c' : '#c2561f';
      ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    this.embers = this.embers.filter((m) => m.life > 0 && m.y > -2);
  }
}
