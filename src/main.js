// App entry: wires the simulation (Run) to rendering, input, audio, UI and saves.

import { buildSprites } from './gfx/sprites.js';
import { Renderer } from './gfx/renderer.js';
import { Input } from './core/input.js';
import { AudioEngine } from './systems/audio.js';
import { loadSave, writeSave, recordRun, defaultSave } from './systems/save.js';
import { Hud } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { HubScene } from './ui/hubScene.js';
import { $ } from './ui/dom.js';
import { Run } from './game/run.js';
import { Town } from './game/town.js';
import { VENDORS, TOWN_NAME } from './data/town.js';
import { iconURL } from './gfx/sprites.js';
import { formatInt } from './core/math.js';
import { computeEmbers } from './game/score.js';
import { META_BY_ID, UNLOCK_BY_ID, nextMetaCost, affordableItems } from './data/meta.js';
import { LANDSCAPE_ASPECT } from './data/config.js';

const STEP = 1 / 60;

class App {
  constructor() {
    this.save = loadSave();
    this.sprites = buildSprites();
    this.app = $('#app');
    this.renderer = new Renderer($('#game'), this.sprites);
    this.audio = new AudioEngine();
    this.hub = new HubScene($('#hub-canvas'));
    this.hud = new Hud({ onPause: () => this.pause(), onEquip: (uid) => this.run && this.run.equipItem(uid), onGear: () => this.openGear() });
    this.screens = new Screens({ onAction: (a, d) => this.action(a, d), sprites: this.sprites });
    this.input = new Input($('#controls'), {
      joyBase: $('#joy-base'),
      joyKnob: $('#joy-knob'),
      buttons: { attack: $('#btn-attack'), dash: $('#btn-dash'), nova: $('#btn-nova'), potion: $('#btn-potion'), skill: $('#btn-skill') },
    });
    this.input.onGear = () => {
      if (this.state !== 'run' || !this.run || this.run.modal) return;
      if (this.paused) this.resume();
      else this.openGear();
    };
    this.input.onPause = () => {
      if (this.state === 'town' && !this.town.modal && !this.screens.modalOpen) {
        this.showTitle();
        return;
      }
      if (this.state === 'run' && !this.run.modal) {
        if (this.paused) this.resume();
        else this.pause();
      }
    };

    $('#town-ember-icon').src = iconURL('ember', 'common', 2);
    $('#town-hud').addEventListener('click', (e) => {
      const b = e.target.closest('[data-town]');
      if (!b) return;
      e.stopPropagation();
      this.audio.play('ui');
      if (b.dataset.town === 'settings') this.action('settings', {});
      else this.showTitle();
    });

    this.state = 'title';
    this.run = null;
    this.town = null;
    this.paused = false;
    this.acc = 0;
    this.hitstop = 0;
    this.heldEdges = { dash: false, nova: false, potion: false, skill: false };
    this.endTimer = 0;
    this.heartbeatT = 0;
    this.lastTick = null;
    this.snapshotT = 0;
    this.tutorialT = 0;
    this.tutorialStep = 0;
    this.settingsBack = 'title';

    this.applySettings();
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    window.visualViewport?.addEventListener('resize', () => this.handleResize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    // Audio can only start after a user gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // A run that was interrupted (app closed) still pays its salvage.
    let notice = '';
    if (this.save.pendingRun) {
      const salvage = this.save.pendingRun.embers || 0;
      this.save.embers += salvage;
      this.save.totalEmbers += salvage;
      this.save.stats.runs++;
      this.save.stats.deaths++;
      this.save.pendingRun = null;
      writeSave(this.save);
      notice = `Your last run was interrupted. You salvaged ${salvage} Embers.`;
    }
    this.showTitle(notice);

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ── Settings ──────────────────────────────────────────────
  applySettings() {
    const s = this.save.settings;
    this.audio.setVolumes(s.musicVolume, s.sfxVolume);
    this.input.sensitivity = s.sensitivity;
    this.input.autoAttack = s.autoAttack;
    this.renderer.quality = s.graphics === 'high' ? 1 : 0;
    this.renderer.screenShake = s.screenShake;
    if (this.run) {
      this.run.effects.showNumbers = s.damageNumbers;
      this.run.effects.quality = this.renderer.quality;
    }
  }

  handleResize() {
    // Sideways screens get the landscape layout: the game fills the width
    // and the HUD tucks into a slim top strip.
    const wide = window.innerWidth > window.innerHeight * LANDSCAPE_ASPECT;
    document.body.classList.toggle('landscape', wide);
    this.input.joyZone = wide ? 0.5 : 0.62;
    const w = this.app.clientWidth;
    const h = this.app.clientHeight;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.renderer.resize(w, h, dpr, wide);
    this.hub.resize(w, h);
    const pxPerCss = dpr / this.renderer.scale;
    this.renderer.safeTop = Math.ceil((wide ? 58 : 118) * pxPerCss);
    this.renderer.safeBottom = Math.ceil(20 * pxPerCss);
    for (const scene of [this.run, this.town]) {
      if (!scene) continue;
      scene.viewW = this.renderer.W;
      scene.viewH = this.renderer.H;
    }
    this.input.resetJoystickVisual();
  }

  // ── Screens ───────────────────────────────────────────────
  showTitle(notice = '') {
    this.state = 'title';
    this.hud.hide();
    $('#controls').classList.add('hidden');
    $('#town-hud').classList.add('hidden');
    this.hub.start();
    this.screens.hideModal();
    this.screens.title(this.save, notice);
    if (this.audio.ctx) this.audio.startMusic(-1);
  }

  /** Emberfall: walk to vendors to spend Embers, take the portal to start a run. */
  showTown() {
    this.audio.unlock();
    this.state = 'town';
    this.run = null;
    this.paused = false;
    this.hub.stop();
    this.hud.hide();
    this.screens.hideScreen();
    this.screens.hideModal();
    this.town = new Town({
      meta: this.save.meta,
      hooks: {
        sfx: (n) => this.audio.play(n),
        openModal: (m) => this.renderTownModal(m),
        closeModal: () => this.screens.hideModal(),
        shake: (a) => this.renderer.addShake(a),
      },
      viewW: this.renderer.W,
      viewH: this.renderer.H,
    });
    this.town.effects.quality = this.renderer.quality;
    this.renderer.prepare(this.town);
    $('#controls').classList.remove('hidden');
    $('#controls').classList.add('town-mode');
    $('#town-hud').classList.remove('hidden');
    this.updateTownHud();
    this.input.releaseAll();
    this.input.enabled = true;
    this.input.resetJoystickVisual();
    this.audio.stopMusic();
    if (this.audio.ctx) this.audio.startMusic(-1);
    if (!this.save.townTutorialDone) {
      this.hud.banner(TOWN_NAME.toUpperCase(), 'Walk to a vendor to shop. The Rift Portal is north.', 'gold');
      this.save.townTutorialDone = true;
      writeSave(this.save);
    }
  }

  updateTownHud() {
    $('#town-embers').textContent = formatInt(this.save.embers);
  }

  renderTownModal(m) {
    this.input.releaseAll();
    if (m.kind === 'vendor') this.screens.vendor(this.save, m.vendor);
    else if (m.kind === 'portal') this.screens.portal(this.save);
    else if (m.kind === 'board') this.screens.board(this.save);
  }

  // ── Runs ──────────────────────────────────────────────────
  startRun(biome = this.lastBiome || 'forest') {
    this.audio.unlock();
    this.audio.play('ui');
    this.lastBiome = biome;
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.run = new Run({
      seed,
      biome,
      meta: this.save.meta,
      unlocks: this.save.unlocks,
      hooks: this.makeHooks(),
      viewW: this.renderer.W,
      viewH: this.renderer.H,
    });
    this.applySettings();
    this.state = 'run';
    this.paused = false;
    this.acc = 0;
    this.hitstop = 0;
    this.endTimer = 0;
    this.lastTick = null;
    this.snapshotT = 5;
    this.tutorialT = 0;
    this.tutorialStep = this.save.tutorialDone ? 99 : 0;
    this.hub.stop();
    this.screens.hideScreen();
    this.screens.hideModal();
    this.town = null;
    $('#town-hud').classList.add('hidden');
    $('#controls').classList.remove('town-mode');
    this.hud.show();
    this.hud.lastCount = null;
    $('#controls').classList.remove('hidden');
    this.input.releaseAll();
    this.input.enabled = true;
    this.input.resetJoystickVisual();
    this.renderer.prepare(this.run);
    this.audio.stopMusic();
    this.audio.startMusic(0);
    this.audio.setIntensity(0, false);
    this.finalMusic = false;
    this.hud.banner(this.run.biome.name.toUpperCase(), 'Survive. Loot. Escape before the eclipse.', 'purple');
  }

  makeHooks() {
    return {
      sfx: (name) => this.audio.play(name),
      haptic: (pattern) => {
        if (this.save.settings.vibration && navigator.vibrate) {
          try {
            navigator.vibrate(pattern);
          } catch {
            /* unsupported */
          }
        }
      },
      shake: (a) => this.renderer.addShake(a),
      hitstop: (s) => {
        this.hitstop = Math.max(this.hitstop, s);
      },
      toast: (t, k) => this.hud.toast(t, k),
      banner: (t, s, k) => this.hud.banner(t, s, k),
      openModal: (m) => this.renderRunModal(m),
      closeModal: () => this.screens.hideModal(),
      itemPickup: (item, compare) => this.hud.pickup(item, compare),
      damageFlash: () => this.hud.damageFlash(),
      phase: (phase) => this.audio.setIntensity(phase.musicIntensity, this.run && this.run.timeLeft <= 60),
      end: (result) => this.onRunEnd(result),
    };
  }

  renderRunModal(m) {
    const fresh = !this.screens.modalOpen;
    this.input.releaseAll();
    switch (m.kind) {
      case 'levelup':
        this.screens.levelUp(m, fresh);
        break;
      case 'event':
        this.screens.event(m);
        break;
      case 'escape':
        this.screens.escape(this.run);
        break;
      case 'merchant':
        this.screens.merchant(this.run, m, fresh);
        break;
    }
  }

  pause() {
    if (this.state !== 'run' || !this.run || this.run.ended || this.run.modal) return;
    this.paused = true;
    this.input.releaseAll();
    this.screens.pause(this.run);
  }

  /** Equipment screen pauses the run while open. */
  openGear(selectedUid = null) {
    if (this.state !== 'run' || !this.run || this.run.ended || this.run.modal) return;
    this.paused = true;
    this.input.releaseAll();
    this.screens.gear(this.run, selectedUid);
  }

  resume() {
    this.paused = false;
    this.screens.hideModal();
    this.last = performance.now();
  }

  onVisibility() {
    if (document.hidden) {
      this.audio.suspend();
      if (this.state === 'run' && !this.paused && this.run && !this.run.modal && !this.run.ended) this.pause();
      if (this.state === 'run') this.snapshot();
    } else {
      this.audio.resume();
      this.last = performance.now();
    }
  }

  /** Persist what dying right now would pay, so closing the app mid-run isn't a total loss. */
  snapshot() {
    const run = this.run;
    if (!run || run.ended) return;
    const e = computeEmbers({ outcome: 'died', gold: run.gold, kills: run.stats.kills, elites: run.stats.elites, champions: run.stats.champions, elapsed: run.elapsed, items: run.haul() });
    this.save.pendingRun = { embers: e.total, at: Date.now() };
    writeSave(this.save);
  }

  onRunEnd(result) {
    const escaped = result.outcome === 'escaped';
    this.input.enabled = false;
    this.input.releaseAll();
    this.screens.hideModal();
    this.paused = false;
    this.endTimer = escaped ? 1.1 : 1.6;
    this.audio.stopMusic();
    if (escaped) {
      this.audio.play('extract');
      this.hud.whiteFlash();
      const p = this.run.player;
      this.run.effects.ring(p.x, p.y - 6, 40, '#b68cff', 0.8, 2);
      this.run.effects.burst(p.x, p.y - 6, ['#b68cff', '#f4f2ff', '#7a3fc0'], 40, 90, 0.9, -20);
    } else {
      this.audio.play('death');
      this.renderer.addShake(8);
      const p = this.run.player;
      this.run.effects.burst(p.x, p.y - 6, ['#f4f2ff', '#c9c6dc', '#e0384a', '#7a3fc0'], 30, 70, 1, 40);
      if (this.save.settings.vibration && navigator.vibrate) navigator.vibrate([60, 40, 120]);
    }
    // Save immediately.
    const before = affordableItems(this.save).map((x) => `${x.kind}:${x.id}`);
    const embersBefore = this.save.embers;
    const { newRecords, regionUnlocked } = recordRun(this.save, result);
    this.save.tutorialDone = true;
    const after = affordableItems(this.save);
    const fresh = after.filter((x) => !before.includes(`${x.kind}:${x.id}`));
    let unlockHint = fresh[0] || null;
    if (unlockHint) {
      const v = VENDORS.find((vv) => vv.items.some((it) => it.kind === unlockHint.kind && it.id === unlockHint.id));
      unlockHint = { ...unlockHint, vendor: v ? v.name : null };
    }
    this.pendingResults = { result, newRecords, unlockHint, regionUnlocked, embersBefore };
    writeSave(this.save);
  }

  showResults() {
    const r = this.pendingResults;
    this.state = 'results';
    this.hud.hide();
    $('#controls').classList.add('hidden');
    this.hub.start();
    this.screens.results(r.result, r);
    this.audio.startMusic(-1);
  }

  // ── UI actions ────────────────────────────────────────────
  action(a, d) {
    const run = this.run;
    if (a !== 'setSetting') this.audio.play('ui');
    switch (a) {
      case 'start':
        this.startRun();
        break;
      case 'town':
        this.showTown();
        break;
      case 'enterRegion':
        this.screens.hideModal();
        this.startRun(d.biome);
        break;
      case 'townClose':
        if (this.town) this.town.closeModal();
        else this.screens.hideModal();
        break;
      case 'title':
        this.showTitle();
        break;
      case 'buyMeta': {
        const up = META_BY_ID[d.id];
        const rank = this.save.meta[d.id] || 0;
        const cost = nextMetaCost(up, rank);
        if (cost !== null && this.save.embers >= cost) {
          this.save.embers -= cost;
          this.save.meta[d.id] = rank + 1;
          writeSave(this.save);
          this.audio.play('levelUp');
        }
        this.refreshVendor();
        break;
      }
      case 'buyUnlock': {
        const un = UNLOCK_BY_ID[d.id];
        if (un && !this.save.unlocks[d.id] && this.save.embers >= un.cost) {
          this.save.embers -= un.cost;
          this.save.unlocks[d.id] = true;
          writeSave(this.save);
          this.audio.play('legendary');
        }
        this.refreshVendor();
        break;
      }
      case 'pickUpgrade':
        run && run.chooseUpgrade(Number(d.index));
        break;
      case 'reroll':
        run && run.rerollUpgrades();
        break;
      case 'eventChoice':
        run && run.resolveEvent(d.choice);
        break;
      case 'closeModal':
        if (run && run.modal) run.closeModal();
        else this.screens.hideModal();
        break;
      case 'escape':
        run && run.escape();
        break;
      case 'buy':
        if (run && run.buyFromMerchant(Number(d.index))) this.screens.merchant(run, run.modal, false);
        break;
      case 'resume':
        this.resume();
        break;
      case 'gear':
        this.paused = false;
        this.openGear();
        break;
      case 'gearSelect':
        if (d.uid) this.screens.gear(this.run, d.uid);
        break;
      case 'gearEquip':
        if (run && run.equipItem(Number(d.uid))) this.screens.gear(this.run, d.uid);
        break;
      case 'gearClose':
        this.resume();
        break;
      case 'settings':
        this.settingsBack = this.state === 'run' ? 'pauseBack' : 'settingsClose';
        if (this.state === 'town') this.input.releaseAll();
        this.screens.settings(this.save.settings, this.settingsBack);
        break;
      case 'settingsClose':
        this.screens.hideModal();
        break;
      case 'pauseBack':
        this.screens.pause(this.run);
        break;
      case 'toggleSetting':
        this.save.settings[d.key] = !this.save.settings[d.key];
        writeSave(this.save);
        this.applySettings();
        this.screens.settings(this.save.settings, this.settingsBack);
        break;
      case 'toggleGraphics':
        this.save.settings.graphics = this.save.settings.graphics === 'high' ? 'low' : 'high';
        writeSave(this.save);
        this.applySettings();
        this.screens.settings(this.save.settings, this.settingsBack);
        break;
      case 'setSetting':
        this.save.settings[d.key] = Number(d.value);
        writeSave(this.save);
        this.applySettings();
        break;
      case 'abandonConfirm':
        this.screens.confirm('Abandon this run? You will lose your loot and keep only what dying would give.', 'abandon', 'pauseBack');
        break;
      case 'abandon':
        this.paused = false;
        run && run.abandon();
        break;
      case 'resetConfirm':
        this.screens.confirm('Erase all Embers, upgrades, unlocks and records? This cannot be undone.', 'reset', this.settingsBack === 'pauseBack' ? 'pauseBack' : 'settings');
        break;
      case 'reset': {
        const settings = this.save.settings;
        this.save = defaultSave();
        this.save.settings = settings;
        writeSave(this.save);
        this.screens.hideModal();
        if (this.state !== 'run') this.showTitle('Progress reset.');
        else this.screens.pause(this.run);
        break;
      }
    }
  }

  refreshVendor() {
    if (this.town && this.town.modal && this.town.modal.kind === 'vendor') this.screens.vendor(this.save, this.town.modal.vendor, false);
    if (this.town) {
      // New meta upgrades apply to the town hero too (speed, HP).
      this.town.player.metaMods = Town.metaFor(this.save.meta);
      this.town.player.recompute();
    }
    this.updateTownHud();
  }

  // ── Main loop ─────────────────────────────────────────────
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if ((this.state === 'run' || this.state === 'ending') && this.run) this.tickRun(dt);
    else if (this.state === 'town' && this.town) this.tickTown(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  tickRun(dt) {
    const run = this.run;
    if (run.ended) {
      // Slow-motion death / escape beat before the results screen.
      run.effects.update(dt * 0.4);
      this.renderer.render(run, dt * 0.4);
      if (this.pendingResults) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) {
          this.showResults();
          this.pendingResults = null;
        }
      }
      return;
    }
    const input = this.input.read();
    input.dash = input.dash || this.heldEdges.dash;
    input.nova = input.nova || this.heldEdges.nova;
    input.potion = input.potion || this.heldEdges.potion;
    input.skill = input.skill || this.heldEdges.skill;
    let steps = 0;
    if (!this.paused && !run.modal) {
      if (this.hitstop > 0) {
        this.hitstop -= dt;
      } else {
        this.acc += dt;
        while (this.acc >= STEP && steps < 5) {
          const edgeless = steps > 0;
          run.update(STEP, edgeless ? { ...input, dash: false, nova: false, potion: false } : input);
          this.acc -= STEP;
          steps++;
          if (run.modal || run.ended || this.hitstop > 0) break;
        }
        if (steps >= 5) this.acc = 0;
      }
    }
    this.heldEdges = steps === 0 && !run.modal && !this.paused ? { dash: input.dash, nova: input.nova, potion: input.potion, skill: input.skill } : { dash: false, nova: false, potion: false, skill: false };

    this.renderer.render(run, this.paused || run.modal ? 0 : dt);
    this.hud.update(run, dt);
    this.runAmbience(run, dt);
  }

  tickTown(dt) {
    const town = this.town;
    const input = this.input.read();
    if (!town.modal && !this.screens.modalOpen) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        town.update(STEP, steps === 0 ? input : { ...input, dash: false });
        this.acc -= STEP;
        steps++;
        if (town.modal) break;
      }
      if (steps >= 5) this.acc = 0;
    }
    this.renderer.render(town, town.modal || this.screens.modalOpen ? 0 : dt);
  }

  runAmbience(run, dt) {
    if (this.paused || run.modal) return;
    if (!this.finalMusic && run.timeLeft <= 60) {
      this.finalMusic = true;
      this.audio.setIntensity(3, true);
      this.hud.banner('THE LAST MINUTE', 'Reach a Rift Gate or lose everything.', 'danger');
      this.audio.play('phase');
    }
    const c = Math.ceil(run.timeLeft);
    if (run.timeLeft <= 10 && c !== this.lastTick) {
      this.lastTick = c;
      this.audio.play('tick');
    }
    const p = run.player;
    if (p.hp / p.stats.maxHp < 0.3) {
      this.heartbeatT -= dt;
      if (this.heartbeatT <= 0) {
        this.heartbeatT = 0.95;
        this.audio.play('heartbeat');
      }
    }
    this.snapshotT -= dt;
    if (this.snapshotT <= 0) {
      this.snapshotT = 10;
      this.snapshot();
    }
    // First-run hints.
    if (this.tutorialStep < 99) {
      this.tutorialT += dt;
      const hints = [
        [1, 'Drag anywhere on the left to move'],
        [5, 'Hold the sword button to attack — it aims for you'],
        [10, 'Tap the feather to dash through danger'],
        [16, 'Follow the purple arrow to a Rift Gate to escape'],
        [24, 'Escape before 0:00 or lose everything you carry'],
      ];
      const h = hints[this.tutorialStep];
      if (h && this.tutorialT >= h[0]) {
        this.hud.toast(h[1], 'purple');
        this.tutorialStep++;
      }
      if (!h) this.tutorialStep = 99;
    }
  }
}

const app = new App();
window.__game = app; // handy for debugging and automated tests

// Offline support when served as a standalone page (skipped on localhost and inside embeds).
const standalone = window.self === window.top;
if (standalone && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
