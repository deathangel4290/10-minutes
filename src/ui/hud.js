// In-run HUD: bars, timer, gold, minimap, toasts, banners, pickup cards.

import { $, esc, setText, setStyle, setClass } from './dom.js';
import { iconURL } from '../gfx/sprites.js';
import { formatTime, formatInt } from '../core/math.js';
import { PLAYER_BASE, MAP_TILES } from '../data/config.js';
import { RARITY_INFO } from '../data/rarities.js';
import { itemLines } from '../game/items.js';
import { T } from '../game/map.js';

const MINIMAP_COLORS = {
  [T.GRASS]: [32, 58, 44],
  [T.DARK]: [24, 46, 38],
  [T.DIRT]: [74, 58, 63],
  [T.STONE]: [58, 56, 80],
  [T.WALL]: [110, 100, 140],
  [T.TREE]: [14, 34, 26],
  [T.BORDER]: [8, 16, 13],
  [T.PILLAR]: [90, 84, 116],
};

export function itemIconURL(item, scale = 4) {
  if (item.kind === 'weapon') return iconURL(item.type, item.rarity, scale);
  if (item.kind === 'relic') return iconURL(item.icon, item.rarity, scale);
  return iconURL('potion', 'common', scale);
}

export class Hud {
  constructor({ onPause, onEquip }) {
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
    this.mimg = this.mctx.createImageData(MAP_TILES, MAP_TILES);
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
    const N = MAP_TILES;
    const d = this.mimg.data;
    const map = run.map;
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
    let sub = `${info.label} ${item.kind === 'relic' ? 'RELIC' : item.type.toUpperCase()}`;
    let right = '';
    if (item.kind === 'weapon' && compare) {
      if (compare.autoEquipped) sub += ' · EQUIPPED';
      else {
        const pct = Math.round(compare.dpsDelta * 100);
        const cls = pct >= 0 ? 'delta-up' : 'delta-down';
        lines.unshift(`<span class="${cls}">${pct >= 0 ? '+' : ''}${pct}% DPS vs current</span>`);
        right = `<button class="btn btn-small ${pct >= 0 ? 'btn-primary' : ''}" data-equip="${item.uid}">EQUIP</button>`;
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
