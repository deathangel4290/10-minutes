// In-run HUD: bars, timer, gold, minimap, toasts, banners, pickup cards.

import { $, esc, setText, setStyle, setClass } from './dom.js';
import { iconURL } from '../gfx/sprites.js';
import { formatTime, formatInt } from '../core/math.js';
import { PLAYER_BASE } from '../data/config.js';
import { BIOME_PALETTES } from '../gfx/palette.js';
import { RARITY_INFO } from '../data/rarities.js';
import { itemLines } from '../game/items.js';
import { T } from '../game/map.js';

function minimapColors(paletteName) {
  const m = (BIOME_PALETTES[paletteName] || BIOME_PALETTES.forest).minimap;
  return {
    [T.GRASS]: m.ground,
    [T.DARK]: m.dark,
    [T.DIRT]: m.dirt,
    [T.STONE]: m.stone,
    [T.WALL]: m.wall,
    [T.TREE]: m.tree,
    [T.BORDER]: m.border,
    [T.PILLAR]: m.wall,
    [T.ICE]: m.pool,
    [T.LAVA]: m.pool,
    [T.COBBLE]: m.stone,
  };
}

export function itemIconURL(item, scale = 4) {
  if (item.kind === 'weapon') return iconURL(item.type, item.rarity, scale);
  if (item.kind === 'armor') return iconURL(item.icon, item.rarity, scale);
  if (item.kind === 'relic') return iconURL(item.icon, item.rarity, scale);
  return iconURL('potion', 'common', scale);
}

/** One short line that always says what to do next. */
function objectiveText(run) {
  const p = run.player;
  let best = null;
  let bd = Infinity;
  for (const g of run.pois) {
    if (g.type !== 'gate' || !g.open) continue;
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  if (!best) return 'NO GATES LEFT';
  const meters = Math.round(bd / 8);
  const closing = run.pois.find((g) => g.type === 'gate' && g.open && g.closing);
  if (closing) return `A GATE CLOSES IN ${Math.max(0, Math.ceil(run.timeLeft - closing.closesAt))}S`;
  if (run.timeLeft <= 60) return `ESCAPE! GATE ${meters}M`;
  return `GATE ${meters}M \u00b7 LOOT, THEN LEAVE`;
}

function statOf(item, stat) {
  if (!item) return 0;
  return item.mods.filter((m) => m.stat === stat).reduce((s, m) => s + m.value, 0);
}

export class Hud {
  constructor({ onPause, onEquip, onGear }) {
    this.root = $('#hud');
    this.hp = $('.bar-hp', this.root);
    this.hpFill = $('.bar-hp .bar-fill', this.root);
    this.hpText = $('.bar-hp .bar-text', this.root);
    this.en = $('.bar-energy', this.root);
    this.enFill = $('.bar-energy .bar-fill', this.root);
    this.xpFill = $('.bar-xp .bar-fill', this.root);
    this.lvl = $('.lvl', this.root);
    this.timerBox = $('.hud-timer', this.root);
    this.timer = $('.timer', this.root);
    this.danger = $('.danger', this.root);
    this.gold = $('.gold span', this.root);
    this.champBar = $('#champion-bar');
    this.champFill = $('#champion-bar .bar-fill');
    this.toasts = $('#toasts');
    this.bannerEl = $('#banner');
    this.countdown = $('#countdown');
    this.card = $('#pickup-card');
    this.minimap = $('#minimap');
    this.mctx = this.minimap.getContext('2d');
    this.mimg = null;
    this.status = $('#status');
    this.objective = $('.objective', this.root);
    this.vignette = $('#fx-vignette');
    this.flash = $('#fx-flash');
    this.btnNova = $('#btn-nova');
    this.btnDash = $('#btn-dash');
    this.btnPotion = $('#btn-potion');
    this.novaFill = $('#btn-nova .fill');
    this.dashCd = $('#btn-dash .cd');
    this.potionBadge = $('#btn-potion .badge');

    $('.bar-hp .bar-icon', this.root).src = iconURL('heart', 'common', 2);
    $('.bar-energy .bar-icon', this.root).src = iconURL('gem', 'common', 2);
    $('.gold img', this.root).src = iconURL('coin', 'common', 2);
    $('#btn-attack img').src = iconURL('sword', 'legendary', 4);
    $('#btn-dash img').src = iconURL('dash', 'common', 4);
    $('#btn-nova img').src = iconURL('nova', 'common', 4);
    $('#btn-potion img').src = iconURL('potion', 'common', 4);

    $('#btn-pause').addEventListener('click', (e) => {
      e.stopPropagation();
      onPause();
    });
    $('#btn-gear img').src = iconURL('bag', 'common', 2);
    $('#btn-gear').addEventListener('click', (e) => {
      e.stopPropagation();
      onGear();
    });
    this.onEquip = onEquip;
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-equip]');
      if (b) {
        this.onEquip(Number(b.dataset.equip));
        this.hideCard();
      }
    });
    this.minimapT = 0;
    this.cardT = 0;
    this.lastCount = null;
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
    this.hideCard();
    this.toasts.innerHTML = '';
    this.bannerEl.classList.add('hidden');
    setStyle(this.vignette, 'opacity', '0');
    this.countdown.textContent = '';
  }

  update(run, dt) {
    const p = run.player;
    const s = p.stats;
    const hpPct = Math.max(0, p.hp / s.maxHp);
    setStyle(this.hpFill, 'width', `${(hpPct * 100).toFixed(1)}%`);
    setText(this.hpText, `${Math.ceil(Math.max(0, p.hp))}/${s.maxHp}`);
    setClass(this.hp, 'low', hpPct < 0.3);
    const ePct = p.energy / PLAYER_BASE.energyMax;
    setStyle(this.enFill, 'width', `${(ePct * 100).toFixed(1)}%`);
    const novaReady = p.energy >= PLAYER_BASE.novaCost;
    setClass(this.en, 'ready', novaReady);
    setStyle(this.xpFill, 'width', `${((p.xp / p.xpToNext) * 100).toFixed(1)}%`);
    setText(this.lvl, `LV ${p.level}`);
    setText(this.timer, formatTime(run.timeLeft));
    setText(this.danger, run.timeLeft <= 60 ? 'THE LAST MINUTE' : run.phase.name);
    for (let i = 0; i < 4; i++) setClass(this.timerBox, `d${i}`, run.phase.id === i);
    setClass(this.timerBox, 'final', run.timeLeft <= 60);
    setText(this.gold, formatInt(run.gold));

    setStyle(this.novaFill, 'height', `${Math.min(100, (p.energy / PLAYER_BASE.novaCost) * 100).toFixed(0)}%`);
    setClass(this.btnNova, 'ready', novaReady);
    const dashPct = Math.max(0, p.dashCd / s.dashCooldown);
    setStyle(this.dashCd, 'transform', `scaleY(${dashPct.toFixed(2)})`);
    setText(this.potionBadge, `${p.potions}`);
    setClass(this.btnPotion, 'empty', p.potions <= 0);

    // Status chips: what is happening to you right now.
    const chips = [];
    if (run.hunted) chips.push(['danger', 'HUNTED \u00b7 KEEP MOVING']);
    else if (run.huntProgress > 0.6) chips.push(['warn', 'LINGERING TOO LONG']);
    if (run.frost > 2) chips.push(['frost', run.frost > 4 ? 'FREEZING \u00b7 MOVE!' : 'GETTING COLD']);
    if (run.map.tileAt(p.x, p.y) === T.LAVA) chips.push(['danger', 'BURNING']);
    if ((run.phase.healMult ?? 1) < 1) chips.push(['muted', `HEALING -${Math.round((1 - run.phase.healMult) * 100)}%`]);
    const chipKey = chips.map((c) => c.join(':')).join('|');
    if (chipKey !== this.chipKey) {
      this.chipKey = chipKey;
      this.status.innerHTML = chips.map(([k, t]) => `<span class="chip ${k}">${t}</span>`).join('');
    }
    setText(this.objective, objectiveText(run));

    // Champion bar.
    const ch = run.championRef;
    setClass(this.champBar, 'hidden', !ch || ch.dead);
    if (ch && !ch.dead) setStyle(this.champFill, 'width', `${((ch.hp / ch.maxHp) * 100).toFixed(1)}%`);

    // Low HP + final-minute vignette.
    let vig = 0;
    if (hpPct < 0.35) vig = (0.35 - hpPct) / 0.35;
    if (run.timeLeft <= 60) vig = Math.max(vig, 0.35 + Math.sin(performance.now() / 160) * 0.15);
    setStyle(this.vignette, 'opacity', vig.toFixed(2));

    // Final 10 seconds countdown.
    const c = Math.ceil(run.timeLeft);
    if (run.timeLeft <= 10 && c !== this.lastCount && c > 0) {
      this.lastCount = c;
      this.countdown.textContent = c;
      this.countdown.classList.remove('tick');
      void this.countdown.offsetWidth;
      this.countdown.classList.add('tick');
    }

    this.minimapT -= dt;
    if (this.minimapT <= 0) {
      this.minimapT = 0.25;
      this.drawMinimap(run);
    }
    if (this.cardT > 0) {
      this.cardT -= dt;
      if (this.cardT <= 0) this.hideCard();
    }
  }

  drawMinimap(run) {
    const map = run.map;
    const N = map.n;
    if (!this.mimg || this.mimg.width !== N || this.mimgPalette !== map.biome.palette) {
      this.minimap.width = N;
      this.minimap.height = N;
      this.mimg = this.mctx.createImageData(N, N);
      this.mimgPalette = map.biome.palette;
      this.mcolors = minimapColors(map.biome.palette);
    }
    const MINIMAP_COLORS = this.mcolors;
    const d = this.mimg.data;
    for (let i = 0; i < N * N; i++) {
      const o = i * 4;
      if (!run.explored[i]) {
        d[o] = 6;
        d[o + 1] = 5;
        d[o + 2] = 10;
        d[o + 3] = 255;
        continue;
      }
      const c = MINIMAP_COLORS[map.tiles[i]];
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
    const ctx = this.mctx;
    ctx.putImageData(this.mimg, 0, 0);
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    const dot = (x, y, color, size = 2) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(x / 16) - (size >> 1), Math.floor(y / 16) - (size >> 1), size, size);
    };
    for (const z of map.cursedZones) {
      if (!run.explored[Math.floor(z.y / 16) * N + Math.floor(z.x / 16)]) continue;
      ctx.fillStyle = 'rgba(122, 63, 192, 0.35)';
      ctx.beginPath();
      ctx.arc(z.x / 16, z.y / 16, z.r / 16, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const poi of run.pois) {
      if (poi.type === 'gate') dot(poi.x, poi.y, poi.open ? (poi.closing && blink ? '#ff5a5a' : '#c48cff') : '#3a3350', 4);
      else if (!poi.discovered) continue;
      else if (poi.type === 'chest' && !poi.opened) dot(poi.x, poi.y, RARITY_INFO[poi.rarity].color, 2);
      else if (poi.type === 'shrine' && !poi.used) dot(poi.x, poi.y, '#e0384a', 2);
      else if (poi.type === 'mystery' && !poi.used) dot(poi.x, poi.y, '#b68cff', 2);
      else if (poi.type === 'merchant') dot(poi.x, poi.y, blink ? '#ffd36b' : '#c2561f', 3);
    }
    if (run.championRef && !run.championRef.dead && blink) dot(run.championRef.x, run.championRef.y, '#ff3a3a', 3);
    dot(run.player.x, run.player.y, blink ? '#ffffff' : '#ffd36b', 3);
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 3100);
  }

  banner(title, sub = '', kind = 'purple') {
    const b = this.bannerEl;
    b.className = kind;
    $('.banner-title', b).textContent = title;
    $('.banner-sub', b).textContent = sub || '';
    void b.offsetWidth;
    b.classList.remove('hidden');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 2700);
  }

  damageFlash() {
    const f = this.flash;
    f.className = '';
    void f.offsetWidth;
    f.className = 'hit';
  }

  whiteFlash() {
    const f = this.flash;
    f.className = '';
    void f.offsetWidth;
    f.className = 'white';
  }

  /** Non-blocking card for picked-up items; weapons get an EQUIP button. */
  pickup(item, compare) {
    if (item.kind === 'potion') {
      this.toast('+1 Health Potion', 'muted');
      return;
    }
    const info = RARITY_INFO[item.rarity];
    const lines = itemLines(item).slice(0, 3);
    let sub = `${info.label} ${item.kind === 'relic' ? 'RELIC' : item.kind === 'armor' ? item.slot.toUpperCase() : item.type.toUpperCase()}`;
    let right = '';
    if (item.kind === 'weapon' && compare) {
      if (compare.autoEquipped) sub += ' · EQUIPPED';
      else {
        const pct = Math.round(compare.dpsDelta * 100);
        const cls = pct >= 0 ? 'delta-up' : 'delta-down';
        lines.unshift(`<span class="${cls}">${pct >= 0 ? '+' : ''}${pct}% DPS vs current</span>`);
        right = `<button class="btn btn-small ${pct >= 0 ? 'btn-primary' : ''}" data-equip="${item.uid}">EQUIP</button>`;
      }
    } else if (item.kind === 'armor' && compare) {
      if (compare.autoEquipped) sub += ' · EQUIPPED';
      else {
        const da = statOf(item, 'armor') - statOf(compare.current, 'armor');
        const dh = statOf(item, 'maxHp') - statOf(compare.current, 'maxHp');
        const fmt = (v, label) => `<span class="${v >= 0 ? 'delta-up' : 'delta-down'}">${v >= 0 ? '+' : ''}${v} ${label}</span>`;
        lines.unshift(`${fmt(da, 'armor')} · ${fmt(dh, 'HP')} <span>vs worn</span>`);
        right = `<button class="btn btn-small ${compare.scoreDelta >= 0 ? 'btn-primary' : ''}" data-equip="${item.uid}">EQUIP</button>`;
      }
    } else if (item.kind === 'relic') {
      sub += ' · ACTIVE';
    }
    this.card.innerHTML = `
      <div class="pc-icon" style="border-color:${info.color}"><img src="${itemIconURL(item)}" alt=""></div>
      <div>
        <div class="pc-name" style="color:${info.color}">${esc(item.name)}</div>
        <div class="pc-sub">${sub}</div>
        <div class="pc-lines">${lines.map((l) => (l.startsWith('<span') ? l : esc(l))).join('<br>')}</div>
      </div>
      <div>${right}</div>`;
    this.card.classList.remove('hidden');
    this.cardT = right ? 5 : 3.2;
  }

  hideCard() {
    this.card.classList.add('hidden');
    this.cardT = 0;
  }
}
