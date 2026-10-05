// Visual-only effects: particles, damage numbers, slashes, shockwaves,
// lightning and loot beams. Pooled arrays to avoid garbage on weak phones.

const MAX_PARTICLES = 420;
const MAX_NUMBERS = 60;

export class Effects {
  constructor() {
    this.particles = [];
    this.numbers = [];
    this.slashes = [];
    this.rings = [];
    this.bolts = [];
    this.beams = [];
    this.texts = [];
    this.afterimages = [];
    this.telegraphs = [];
    this.quality = 1; // 0 = low, 1 = high
    this.showNumbers = true;
  }

  particle(x, y, vx, vy, life, color, size = 1, gravity = 0, drag = 2.5) {
    if (this.particles.length >= MAX_PARTICLES * (this.quality ? 1 : 0.4)) return;
    this.particles.push({ x, y, vx, vy, life, max: life, color, size, gravity, drag });
  }

  burst(x, y, colors, count = 10, speed = 60, life = 0.45, gravity = 40) {
    const n = this.quality ? count : Math.ceil(count / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.particle(x, y, Math.cos(a) * s, Math.sin(a) * s - 15, life * (0.6 + Math.random() * 0.6), colors[i % colors.length], Math.random() < 0.3 ? 2 : 1, gravity);
    }
  }

  /** Floating number. Hits on the same target in quick succession merge into one number. */
  number(x, y, value, color = '#f4f2ff', scale = 1, key = null) {
    if (!this.showNumbers) return;
    if (key !== null && typeof value === 'number') {
      for (const n of this.numbers) {
        if (n.key === key && n.color === color && n.max - n.life < 0.3) {
          n.value += value;
          n.text = String(Math.round(n.value));
          n.life = n.max;
          n.scale = Math.max(n.scale, scale);
          return;
        }
      }
    }
    if (this.numbers.length >= MAX_NUMBERS) this.numbers.shift();
    this.numbers.push({ x: x + (Math.random() - 0.5) * 6, y, vy: -28 - scale * 6, text: String(value), value: typeof value === 'number' ? value : 0, key, color, scale, life: 0.7, max: 0.7 });
  }

  text(x, y, text, color = '#ffd36b', scale = 1, life = 1.1) {
    this.texts.push({ x, y, text, color, scale, life, max: life });
  }

  slash(x, y, angle, arc, range, dir, color = '#f4f2ff') {
    this.slashes.push({ x, y, angle, arc, range, dir, color, life: 0.13, max: 0.13 });
  }

  ring(x, y, radius, color = '#b68cff', life = 0.35, width = 2) {
    this.rings.push({ x, y, radius, color, life, max: life, width });
  }

  bolt(points, color = '#8fd3ff') {
    this.bolts.push({ points, color, life: 0.16, max: 0.16 });
  }

  beam(x, y, color, life = 2.5) {
    this.beams.push({ x, y, color, life, max: life });
  }

  afterimage(x, y, sprite, flip) {
    this.afterimages.push({ x, y, sprite, flip, life: 0.22, max: 0.22 });
  }

  update(dt) {
    const step = (arr, fn) => {
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        e.life -= dt;
        if (e.life <= 0) continue;
        if (fn) fn(e);
        arr[w++] = e;
      }
      arr.length = w;
    };
    step(this.particles, (p) => {
      p.vy += p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    });
    step(this.numbers, (n) => {
      n.y += n.vy * dt;
      n.vy *= Math.exp(-5 * dt);
    });
    step(this.texts, (t) => {
      t.y -= 12 * dt;
    });
    step(this.slashes);
    step(this.rings);
    step(this.bolts);
    step(this.beams);
    step(this.afterimages);
  }
}
