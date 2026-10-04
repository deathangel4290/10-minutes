// Touch + keyboard input. The left side of the screen is a floating joystick
// (touch anywhere there); the right side has Attack (hold), Dash, Nova and Potion.

export class Input {
  constructor(root, { joyBase, joyKnob, buttons }) {
    this.root = root;
    this.joyBase = joyBase;
    this.joyKnob = joyKnob;
    this.buttons = buttons;
    this.sensitivity = 1;
    this.autoAttack = false;
    this.enabled = true;

    this.joyId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.joyVec = { x: 0, y: 0 };
    this.attackPointers = new Set();
    this.keys = new Set();
    this.edges = { dash: false, nova: false, potion: false };
    this.onPause = null;

    this.bindTouch();
    this.bindKeys();
    this.resetJoystickVisual();
  }

  get radius() {
    return 46 / this.sensitivity;
  }

  bindTouch() {
    const zone = this.root;
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.joyId !== null) return;
      if (e.target.closest('[data-btn]')) return;
      const rect = zone.getBoundingClientRect();
      if (e.clientX - rect.left > rect.width * 0.62) return; // right side belongs to buttons
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyVec = { x: 0, y: 0 };
      zone.setPointerCapture?.(e.pointerId);
      this.showJoystick(e.clientX, e.clientY, 0, 0, true);
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      let dx = e.clientX - this.joyOrigin.x;
      let dy = e.clientY - this.joyOrigin.y;
      const r = this.radius;
      const len = Math.hypot(dx, dy);
      // Drag the joystick origin along when the thumb moves far past the edge.
      if (len > r * 1.6) {
        const k = (len - r * 1.6) / len;
        this.joyOrigin.x += dx * k;
        this.joyOrigin.y += dy * k;
        dx = e.clientX - this.joyOrigin.x;
        dy = e.clientY - this.joyOrigin.y;
      }
      const l2 = Math.hypot(dx, dy);
      const m = Math.min(1, l2 / r);
      this.joyVec = l2 > 0 ? { x: (dx / l2) * m, y: (dy / l2) * m } : { x: 0, y: 0 };
      this.showJoystick(this.joyOrigin.x, this.joyOrigin.y, this.joyVec.x * r, this.joyVec.y * r, true);
      e.preventDefault();
    });
    const end = (e) => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.resetJoystickVisual();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    for (const [name, el] of Object.entries(this.buttons)) {
      if (!el) continue;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.enabled) return;
        el.classList.add('pressed');
        if (name === 'attack') {
          this.attackPointers.add(e.pointerId);
          el.setPointerCapture?.(e.pointerId);
        } else {
          this.edges[name] = true;
        }
      });
      const up = (e) => {
        el.classList.remove('pressed');
        if (name === 'attack') this.attackPointers.delete(e.pointerId);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    }
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (!this.enabled) return;
      if (k === 'shift' || k === 'k') this.edges.dash = true;
      if (k === 'e' || k === 'l') this.edges.nova = true;
      if (k === 'q' || k === 'h') this.edges.potion = true;
      if ((k === 'escape' || k === 'p') && this.onPause) this.onPause();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.attackPointers.clear();
      this.joyId = null;
      this.joyVec = { x: 0, y: 0 };
      this.resetJoystickVisual();
    });
  }

  showJoystick(x, y, kx, ky, active) {
    const rect = this.root.getBoundingClientRect();
    this.joyBase.style.transform = `translate(${x - rect.left}px, ${y - rect.top}px)`;
    this.joyKnob.style.transform = `translate(${kx}px, ${ky}px)`;
    this.joyBase.classList.toggle('active', active);
  }

  resetJoystickVisual() {
    const rect = this.root.getBoundingClientRect();
    const x = rect.left + Math.min(110, rect.width * 0.25);
    const y = rect.top + rect.height - 130;
    this.showJoystick(x, y, 0, 0, false);
  }

  /** Read the current frame's input and clear one-shot presses. */
  read() {
    let mx = this.joyVec.x;
    let my = this.joyVec.y;
    const k = this.keys;
    let kx = 0;
    let ky = 0;
    if (k.has('a') || k.has('arrowleft')) kx -= 1;
    if (k.has('d') || k.has('arrowright')) kx += 1;
    if (k.has('w') || k.has('arrowup')) ky -= 1;
    if (k.has('s') || k.has('arrowdown')) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      mx = kx / l;
      my = ky / l;
    }
    const out = {
      moveX: mx,
      moveY: my,
      attack: this.enabled && (this.attackPointers.size > 0 || k.has(' ') || k.has('j')),
      dash: this.edges.dash,
      nova: this.edges.nova,
      potion: this.edges.potion,
      autoAttack: this.autoAttack,
    };
    this.edges.dash = this.edges.nova = this.edges.potion = false;
    return out;
  }

  releaseAll() {
    this.attackPointers.clear();
    this.edges = { dash: false, nova: false, potion: false };
    for (const el of Object.values(this.buttons)) el && el.classList.remove('pressed');
  }
}
