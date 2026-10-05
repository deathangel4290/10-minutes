// All sound is synthesized with WebAudio: no audio files to download, tiny
// footprint, and every effect can be tuned in code. Music is a small step
// sequencer whose layers and tempo rise with the danger phase.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
// D minor: i - VI - iv - V  (Dm, Bb, Gm, A)
const CHORDS = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicVolume = 0.7;
    this.sfxVolume = 0.8;
    this.last = new Map();
    this.music = { playing: false, intensity: -1, final: false, step: 0, nextTime: 0, timer: null, bar: 0 };
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.applyVolumes();
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(music, sfx) {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.sfxGain.gain.value = this.sfxVolume * 0.55;
    this.musicGain.gain.value = this.musicVolume * 0.32;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Synth primitives ──────────────────────────────────────
  tone(type, freq, dur, vol, { to = null, delay = 0, attack = 0.005, out = this.sfxGain, filter = null } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (filter) {
      const f = c.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, { type = 'lowpass', freq = 2000, to = null, q = 1, delay = 0, out = this.sfxGain, attack = 0.002 } = {}) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ── Sound effects ─────────────────────────────────────────
  play(name, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running' || this.sfxVolume <= 0) return;
    const now = this.ctx.currentTime;
    const minGap = { hit: 0.04, die: 0.04, xp: 0.04, coin: 0.05, zap: 0.06, explode: 0.08, swing: 0.05, hurt: 0.1, lunge: 0.15, eliteSpawn: 0.5 }[name] ?? 0.03;
    if (now - (this.last.get(name) || 0) < minGap) return;
    this.last.set(name, now);
    const fn = SFX[name];
    if (fn) fn(this, opts);
  }

  // ── Music ─────────────────────────────────────────────────
  startMusic(intensity = 0) {
    if (!this.ctx) return;
    this.music.intensity = intensity;
    if (this.music.playing) return;
    this.music.playing = true;
    this.music.step = 0;
    this.music.bar = 0;
    this.music.nextTime = this.ctx.currentTime + 0.1;
    this.startPad();
    this.music.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.music.playing = false;
    clearInterval(this.music.timer);
    this.music.timer = null;
    if (this.pad) {
      const t = this.ctx.currentTime;
      this.pad.gain.gain.setTargetAtTime(0.0001, t, 0.4);
      const pad = this.pad;
      setTimeout(() => pad.oscs.forEach((o) => o.stop()), 2000);
      this.pad = null;
    }
  }

  setIntensity(level, final = false) {
    this.music.intensity = level;
    this.music.final = final;
    if (this.pad && this.ctx) {
      const t = this.ctx.currentTime;
      this.pad.filter.frequency.setTargetAtTime(260 + Math.max(0, level) * 180 + (final ? 300 : 0), t, 1.5);
    }
  }

  startPad() {
    const c = this.ctx;
    const gain = c.createGain();
    gain.gain.value = 0.0001;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 2;
    filter.connect(gain).connect(this.musicGain);
    const oscs = [];
    for (const [n, det] of [[38, -6], [38, 7], [45, 3], [50, -4]]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      o.detune.value = det;
      o.connect(filter);
      o.start();
      oscs.push(o);
    }
    gain.gain.setTargetAtTime(0.16, c.currentTime, 1.5);
    this.pad = { gain, filter, oscs };
  }

  schedule() {
    const m = this.music;
    if (!this.ctx || !m.playing) return;
    const tempo = m.final ? 128 : [70, 82, 94, 110][Math.max(0, Math.min(3, m.intensity))];
    const stepDur = 60 / tempo / 4;
    while (m.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(m.step, m.nextTime, stepDur);
      m.nextTime += stepDur;
      m.step = (m.step + 1) % 16;
      if (m.step === 0) m.bar++;
    }
  }

  playStep(step, t, stepDur) {
    const m = this.music;
    const lvl = m.intensity;
    const chord = CHORDS[Math.floor(m.bar / 2) % CHORDS.length];
    const out = this.musicGain;
    const c = this.ctx;
    const at = (fn) => fn(Math.max(0, t - c.currentTime));

    // Pad follows the chord.
    if (step === 0 && m.bar % 2 === 0 && this.pad) {
      this.pad.oscs.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(chord[i % 3] - 12 - (i === 0 ? 12 : 0)), t, 0.3));
    }
    if (lvl < 0) {
      // Hub: a slow, sparse arpeggio.
      if (step % 8 === 0) at((d) => this.tone('triangle', NOTE(chord[(step / 8 + m.bar) % 3] + 12), 1.2, 0.05, { delay: d, attack: 0.05, out }));
      return;
    }
    // Bass.
    if (lvl >= 1 && [0, 6, 8, 14].includes(step)) {
      at((d) => this.tone('triangle', NOTE(chord[0] - 24), stepDur * 2.2, 0.22, { delay: d, out, filter: { freq: 500 } }));
    }
    // Kick.
    if (lvl >= 1 && (step === 0 || step === 8 || (lvl >= 3 && (step === 4 || step === 12)))) {
      at((d) => this.tone('sine', 120, 0.18, 0.5, { to: 40, delay: d, out }));
    }
    // Snare.
    if (lvl >= 2 && (step === 4 || step === 12)) {
      at((d) => this.noise(0.12, 0.18, { type: 'bandpass', freq: 1800, q: 0.8, delay: d, out }));
    }
    // Hats.
    if ((lvl >= 2 && step % 2 === 0) || (lvl >= 3 && step % 2 === 1)) {
      at((d) => this.noise(0.03, step % 4 === 2 ? 0.08 : 0.04, { type: 'highpass', freq: 7000, delay: d, out }));
    }
    // Arpeggio.
    if (lvl >= 2 && step % 2 === 0) {
      const n = chord[(step / 2) % 3] + 12 + (step >= 8 ? 12 : 0);
      at((d) => this.tone('square', NOTE(n), stepDur * 1.6, 0.035, { delay: d, out, filter: { freq: 1800 } }));
    } else if (lvl === 0 && step % 4 === 0) {
      at((d) => this.tone('triangle', NOTE(chord[(step / 4) % 3] + 12), stepDur * 3, 0.045, { delay: d, out }));
    }
    // Final minute alarm.
    if (m.final && (step === 0 || step === 8)) {
      at((d) => this.tone('sawtooth', NOTE(chord[2] + 24), 0.25, 0.05, { delay: d, out, filter: { freq: 2400 } }));
    }
  }
}

// Each effect is a tiny recipe of tones and filtered noise.
const r = (a, b) => a + Math.random() * (b - a);
const SFX = {
  swing: (a) => a.noise(0.08, 0.12, { type: 'bandpass', freq: 2400, to: 700, q: 1.2 }),
  hit: (a) => {
    a.noise(0.06, 0.28, { freq: 3200, to: 800 });
    a.tone('square', r(200, 260), 0.07, 0.1, { to: 90 });
  },
  crit: (a) => {
    a.tone('sine', 140, 0.14, 0.45, { to: 45 });
    a.noise(0.09, 0.3, { freq: 4000, to: 900 });
    a.tone('triangle', 1500, 0.22, 0.09, { to: 1300 });
  },
  die: (a) => {
    a.noise(0.16, 0.22, { freq: 1400, to: 180 });
    a.tone('square', r(150, 190), 0.12, 0.05, { to: 60 });
  },
  eliteDie: (a) => {
    a.tone('sine', 110, 0.5, 0.45, { to: 30 });
    a.noise(0.35, 0.3, { freq: 2000, to: 120 });
    a.tone('triangle', 660, 0.4, 0.08, { to: 990, delay: 0.1 });
  },
  hurt: (a) => {
    a.tone('square', 320, 0.16, 0.16, { to: 110 });
    a.noise(0.1, 0.2, { freq: 900 });
  },
  coin: (a) => {
    a.tone('square', 1320, 0.05, 0.05);
    a.tone('square', 1760, 0.08, 0.05, { delay: 0.045 });
  },
  xp: (a) => a.tone('sine', r(880, 1040), 0.06, 0.05, { to: 1400 }),
  levelUp: (a) => [523, 659, 784, 1046].forEach((f, i) => a.tone('square', f, 0.14, 0.08, { delay: i * 0.07, filter: { freq: 3000 } })),
  select: (a) => {
    a.tone('triangle', 660, 0.12, 0.15, { to: 990 });
    a.tone('triangle', 990, 0.2, 0.08, { delay: 0.08 });
  },
  chest: (a) => {
    a.noise(0.14, 0.18, { freq: 700, to: 300 });
    a.tone('triangle', 880, 0.2, 0.1, { delay: 0.1 });
    a.tone('triangle', 1320, 0.3, 0.08, { delay: 0.18 });
  },
  chestBig: (a) => {
    SFX.chest(a);
    [587, 740, 880, 1175].forEach((f, i) => a.tone('triangle', f, 0.5, 0.07, { delay: 0.25 + i * 0.06 }));
  },
  epicDrop: (a) => [659, 831, 988, 1319].forEach((f, i) => a.tone('triangle', f, 0.6, 0.07, { delay: i * 0.06, attack: 0.02 })),
  legendaryDrop: (a) => {
    a.noise(1.2, 0.08, { type: 'bandpass', freq: 400, to: 6000, q: 2 });
    [587, 740, 880, 1175, 1480, 1760].forEach((f, i) => a.tone('triangle', f, 1.4, 0.07, { delay: 0.1 + i * 0.08, attack: 0.03 }));
    a.tone('sine', 73, 1.2, 0.35, { delay: 0.05 });
  },
  legendary: (a) => SFX.legendaryDrop(a),
  pickup: (a) => a.tone('triangle', 700, 0.09, 0.12, { to: 1050 }),
  pickupRare: (a) => [784, 988, 1175].forEach((f, i) => a.tone('triangle', f, 0.2, 0.09, { delay: i * 0.05 })),
  equip: (a) => {
    a.noise(0.08, 0.2, { type: 'bandpass', freq: 3000, q: 3 });
    a.tone('triangle', 520, 0.18, 0.12, { to: 780 });
  },
  dash: (a) => a.noise(0.16, 0.14, { type: 'bandpass', freq: 500, to: 2600, q: 1.5 }),
  nova: (a) => {
    a.tone('sine', 220, 0.55, 0.4, { to: 40 });
    a.noise(0.45, 0.28, { freq: 3000, to: 150 });
    a.tone('sawtooth', 110, 0.4, 0.06, { to: 55, filter: { freq: 800 } });
  },
  shadow: (a) => a.tone('sawtooth', 700, 0.22, 0.05, { to: 180, filter: { freq: 1500 } }),
  zap: (a) => {
    for (let i = 0; i < 3; i++) a.tone('square', r(900, 2200), 0.03, 0.04, { delay: i * 0.025 });
  },
  explode: (a) => {
    a.noise(0.35, 0.3, { freq: 900, to: 90 });
    a.tone('sine', 90, 0.3, 0.3, { to: 30 });
  },
  slam: (a) => {
    a.noise(0.5, 0.4, { freq: 600, to: 60 });
    a.tone('sine', 70, 0.5, 0.5, { to: 25 });
  },
  lunge: (a) => a.noise(0.12, 0.08, { type: 'bandpass', freq: 900, to: 400, q: 2 }),
  summon: (a) => a.tone('sawtooth', 80, 0.5, 0.12, { to: 50, filter: { freq: 500 } }),
  phase: (a) => {
    [110, 220, 330, 554].forEach((f, i) => a.tone('sine', f, 2.2, i === 0 ? 0.3 : 0.08, { attack: 0.01 }));
  },
  warning: (a) => {
    a.tone('square', 880, 0.1, 0.07);
    a.tone('square', 880, 0.1, 0.07, { delay: 0.18 });
  },
  gateClose: (a) => a.tone('sawtooth', 300, 0.7, 0.1, { to: 60, filter: { freq: 1200 } }),
  merchant: (a) => [784, 659, 880].forEach((f, i) => a.tone('triangle', f, 0.15, 0.08, { delay: i * 0.1 })),
  buy: (a) => {
    SFX.coin(a);
    a.tone('triangle', 990, 0.15, 0.08, { delay: 0.12 });
  },
  shrine: (a) => [146, 220, 293].forEach((f) => a.tone('sawtooth', f, 1.1, 0.05, { attack: 0.2, filter: { freq: 700 } })),
  ambush: (a) => {
    a.tone('sawtooth', 110, 0.6, 0.18, { filter: { freq: 900 } });
    a.tone('sawtooth', 55, 0.7, 0.18, { filter: { freq: 600 } });
    a.noise(0.3, 0.2, { freq: 1500, to: 200 });
  },
  champion: (a) => {
    a.tone('sawtooth', 55, 1.8, 0.22, { attack: 0.2, filter: { freq: 500 } });
    a.tone('sawtooth', 82, 1.8, 0.12, { attack: 0.3, filter: { freq: 500 } });
    a.tone('sine', 41, 1.5, 0.35, { attack: 0.1 });
  },
  eliteSpawn: (a) => a.tone('sawtooth', 75, 0.3, 0.07, { to: 50, filter: { freq: 400 } }),
  potion: (a) => {
    a.tone('sine', 300, 0.1, 0.15, { to: 520 });
    a.tone('sine', 360, 0.12, 0.15, { to: 640, delay: 0.12 });
  },
  death: (a) => {
    a.tone('sine', 90, 1.6, 0.6, { to: 25 });
    a.noise(1.2, 0.3, { freq: 1500, to: 60 });
    [440, 349, 294, 220].forEach((f, i) => a.tone('triangle', f, 0.5, 0.08, { delay: 0.3 + i * 0.22 }));
  },
  extract: (a) => {
    a.noise(1, 0.12, { type: 'bandpass', freq: 300, to: 5000, q: 2 });
    [294, 370, 440, 587, 740, 880].forEach((f, i) => a.tone('triangle', f, 0.9, 0.08, { delay: 0.2 + i * 0.07, attack: 0.02 }));
  },
  tick: (a) => a.tone('square', 1500, 0.03, 0.06),
  ui: (a) => a.tone('triangle', 900, 0.05, 0.06),
  heartbeat: (a) => {
    a.tone('sine', 60, 0.12, 0.35, { to: 40 });
    a.tone('sine', 55, 0.12, 0.25, { to: 38, delay: 0.16 });
  },
};
