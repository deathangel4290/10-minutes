// Full-screen pages (title, results), town modals (vendors, portal, records)
// and in-run modals (level-up, events, escape, merchant, gear, pause,
// settings). Rendered as HTML strings with data-action buttons; main.js
// handles the actions.

import { $, esc } from './dom.js';
import { iconURL, artURL, canvasURL } from '../gfx/sprites.js';
import { PLAYER_BASE } from '../data/config.js';
import { itemIconURL } from './hud.js';
import { formatTime, formatInt } from '../core/math.js';
import { RARITY_INFO } from '../data/rarities.js';
import { META_BY_ID, UNLOCK_BY_ID, nextMetaCost } from '../data/meta.js';
import { VENDOR_BY_ID } from '../data/town.js';
import { BIOMES, BIOME_ORDER, biomeUnlocked } from '../data/biomes.js';
import { UPGRADE_BY_ID } from '../data/upgrades.js';
import { itemLines } from '../game/items.js';
import { phaseForTimeLeft, PHASES } from '../data/config.js';

const ember = () => `<img src="${iconURL('ember', 'common', 2)}" alt="">`;
const pips = (rank, max) => '◆'.repeat(rank) + '◇'.repeat(Math.max(0, max - rank));

export class Screens {
  constructor({ onAction, sprites }) {
    this.sprites = sprites;
    this.screen = $('#screen');
    this.modal = $('#modal');
    this.onAction = onAction;
    this.modalOpenedAt = 0;
    const handler = (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      // Ignore taps that land right as a modal appears (thumbs are often still on the attack button).
      if (el.closest('#modal') && performance.now() - this.modalOpenedAt < 380) return;
      this.onAction(el.dataset.action, el.dataset);
    };
    this.screen.addEventListener('click', handler);
    this.modal.addEventListener('click', handler);
    this.screen.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.modal.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  showScreen(html, dim = true) {
    this.screen.classList.toggle('dim', dim);
    this.screen.innerHTML = html;
    this.screen.classList.remove('hidden');
    this.screen.scrollTop = 0;
  }

  hideScreen() {
    this.screen.classList.add('hidden');
    this.screen.innerHTML = '';
  }

  showModal(html, { fresh = true } = {}) {
    if (fresh || this.modal.classList.contains('hidden')) this.modalOpenedAt = performance.now();
    this.modal.innerHTML = html;
    this.modal.classList.remove('hidden');
  }

  hideModal() {
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
  }

  get modalOpen() {
    return !this.modal.classList.contains('hidden');
  }

  // ── Title ─────────────────────────────────────────────────
  title(save, notice = '') {
    const r = save.records;
    const recs = save.stats.runs > 0 ? `BEST ${formatInt(r.bestScore)} · LONGEST ${formatTime(r.bestSurvival)} · RUNS ${save.stats.runs} · ESCAPES ${save.stats.escapes}` : 'YOUR FIRST RUN AWAITS';
    this.showScreen(`
      <div class="title-wrap">
        <div class="logo">
          <h1>LAST <span class="ten">10</span><br>MINUTES</h1>
          <div class="tagline">SURVIVE · LOOT · ESCAPE · OR RISK IT ALL</div>
        </div>
        <div class="title-bottom">
          ${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
          <div class="center"><span class="ember-pill">${ember()} ${formatInt(save.embers)} Embers</span></div>
          <button class="btn btn-primary" data-action="town">PLAY<span class="sub">Enter Emberfall, then step through the Rift</span></button>
          <div class="btn-row" style="margin-top:0">
            <button class="btn" data-action="settings">SETTINGS</button>
          </div>
          <div class="records-line">${recs}</div>
        </div>
      </div>`,
      false,
    );
  }

  // ── Town: vendors, portal, records ───────────────────────
  metaRow(save, kind, id) {
    if (kind === 'upgrade') {
      const up = META_BY_ID[id];
      const rank = save.meta[up.id] || 0;
      const cost = nextMetaCost(up, rank);
      const can = cost !== null && save.embers >= cost;
      return `<div class="meta-row ${rank > 0 ? 'owned' : ''}">
        <img src="${iconURL(up.icon, 'epic', 4)}" alt="">
        <div><div class="nm">${esc(up.name)}</div><div class="ds">${esc(up.desc)}</div><div class="pips">${pips(rank, up.costs.length)}</div></div>
        ${cost === null ? '<button class="btn cost-btn maxed" disabled>MAX</button>' : `<button class="btn cost-btn ${can ? 'can' : ''}" data-action="buyMeta" data-id="${up.id}" ${can ? '' : 'disabled'}>${ember()}${cost}</button>`}
      </div>`;
    }
    const un = UNLOCK_BY_ID[id];
    const owned = !!save.unlocks[un.id];
    const can = !owned && save.embers >= un.cost;
    return `<div class="meta-row ${owned ? 'owned' : ''}">
      <img src="${iconURL(un.icon, owned ? 'legendary' : 'rare', 4)}" alt="">
      <div><div class="nm">${esc(un.name)}</div><div class="ds">${esc(un.desc)}</div></div>
      ${owned ? '<button class="btn cost-btn maxed" disabled>OWNED</button>' : `<button class="btn cost-btn ${can ? 'can' : ''}" data-action="buyUnlock" data-id="${un.id}" ${can ? '' : 'disabled'}>${ember()}${un.cost}</button>`}
    </div>`;
  }

  vendor(save, vendorId, fresh = true) {
    const v = VENDOR_BY_ID[vendorId];
    const portrait = canvasURL(this.sprites.npc[v.id].r, 5);
    const rows = v.items.map((it) => this.metaRow(save, it.kind, it.id)).join('');
    this.showModal(
      `<div class="panel split wide">
        <div class="col-a">
          <div class="vendor-head">
            <img src="${portrait}" alt="">
            <div><h2 class="modal-title" style="color:${v.color}">${esc(v.name)}</h2><p class="modal-sub">${esc(v.greeting)}</p></div>
          </div>
          <div class="center" style="margin:8px 0"><span class="ember-pill">${ember()} ${formatInt(save.embers)} Embers</span></div>
          <div class="btn-row only-wide"><button class="btn" data-action="townClose">LEAVE</button></div>
        </div>
        <div class="col-b">
          <div class="meta-list">${rows}</div>
          <div class="btn-row only-tall"><button class="btn" data-action="townClose">LEAVE</button></div>
        </div>
      </div>`,
      { fresh },
    );
  }

  portal(save) {
    const cards = BIOME_ORDER.map((id) => {
      const b = BIOMES[id];
      const open = biomeUnlocked(save, id);
      const rec = (save.regions && save.regions[id]) || {};
      const skulls = '\u2620'.repeat(Math.round((b.difficulty - 0.6) * 3.3));
      const lockedBy = b.unlockedBy ? BIOMES[b.unlockedBy].name : '';
      return `<div class="region ${open ? '' : 'locked'}" style="--rc:${b.color}">
        <div class="region-top"><div class="nm">${esc(b.name)}</div><div class="danger-skulls" title="Danger">${skulls}</div></div>
        <div class="ds">${esc(b.blurb)}</div>
        <div class="region-meta">${open ? `REWARDS x${b.reward} \u00b7 MAP ${b.size}x${b.size}${rec.escapes ? ` \u00b7 ESCAPED ${rec.escapes}x` : ''}${rec.best ? ` \u00b7 BEST ${formatTime(rec.best)}` : ''}` : `LOCKED \u00b7 ESCAPE THE ${esc(lockedBy.toUpperCase())} TO OPEN`}</div>
        ${open ? `<button class="btn btn-primary btn-small" data-action="enterRegion" data-biome="${id}">ENTER</button>` : ''}
      </div>`;
    }).join('');
    this.showModal(`<div class="panel wide">
      <h2 class="modal-title" style="color:var(--purple-hi)">RIFT PORTAL</h2>
      <p class="modal-sub">Choose a region. You have 10 minutes. Escape through a Rift Gate before the eclipse.</p>
      <div class="regions">${cards}</div>
      <div class="btn-row"><button class="btn" data-action="townClose">NOT YET</button></div>
    </div>`);
  }

  board(save) {
    const r = save.records;
    const st = save.stats;
    const cells = [
      ['Best score', formatInt(r.bestScore)],
      ['Longest survival', formatTime(r.bestSurvival)],
      ['Latest escape', r.bestEscapeTime ? formatTime(r.bestEscapeTime) : '\u2014'],
      ['Most gold', formatInt(r.mostGold)],
      ['Runs', st.runs],
      ['Escapes', st.escapes],
      ['Enemies slain', formatInt(st.kills)],
      ['Elites slain', formatInt(st.elites)],
      ['Colossi slain', st.champions],
      ['Legendaries found', st.legendaries],
      ['Embers earned', formatInt(save.totalEmbers)],
      ['Time in the rift', formatTime(st.playSeconds)],
    ];
    this.showModal(`<div class="panel wide">
      <h2 class="modal-title">RECORDS</h2>
      <div class="records-grid">${cells.map(([k, v]) => `<div class="rec"><div class="v">${v}</div><div class="k">${k.toUpperCase()}</div></div>`).join('')}</div>
      <div class="btn-row"><button class="btn" data-action="townClose">CLOSE</button></div>
    </div>`);
  }

  // ── Results ───────────────────────────────────────────────
  results(res, { newRecords = [], unlockHint = null, embersBefore = 0, regionUnlocked = null } = {}) {
    const escaped = res.outcome === 'escaped';
    const best = res.bestItem;
    const items = [...res.items].sort((a, b) => RARITY_INFO[b.rarity].tier - RARITY_INFO[a.rarity].tier);
    const strip = items
      .slice(0, 18)
      .map((it) => `<div class="item-chip r-${it.rarity}" title="${esc(it.name)}"><img src="${itemIconURL(it, 3)}" alt=""></div>`)
      .join('');
    const isRecord = (k) => (newRecords.includes(k) ? '<span class="new-record">NEW BEST</span>' : '');
    const rows = res.embers.rows.map((r) => `<div class="${r.negative ? 'neg' : ''}"><span>${esc(r.label)}</span><span>${r.value > 0 ? '+' : ''}${formatInt(r.value)}</span></div>`).join('');
    this.showScreen(`
      <div class="results">
        <div class="res-a">
        <h1 class="res-title ${escaped ? 'escaped' : 'died'}">${escaped ? 'ESCAPED' : 'RUN OVER'}</h1>
        ${
          escaped
            ? `<div class="cause"><div class="d">You slipped through the Rift with ${formatTime(res.timeLeft)} left.</div></div>`
            : `<div class="cause"><div class="k">CAUSE OF DEATH</div><div class="t">${esc(res.causeTitle)}</div><div class="d">${esc(res.causeDetail)}</div></div>`
        }
        <div class="stat-grid">
          <div class="stat"><span class="k">Survival</span><span class="v">${res.survivalText}${isRecord('Longest survival')}</span></div>
          <div class="stat"><span class="k">Enemies</span><span class="v">${formatInt(res.kills)}</span></div>
          <div class="stat"><span class="k">Gold found</span><span class="v">${formatInt(res.goldFound)}</span></div>
          <div class="stat"><span class="k">XP earned</span><span class="v">${formatInt(res.xpEarned)}</span></div>
          <div class="stat"><span class="k">Level</span><span class="v">${res.level}</span></div>
          <div class="stat"><span class="k">Elites</span><span class="v">${res.elites}${res.champions ? ` +${res.champions} ☠` : ''}</span></div>
          <div class="stat wide"><span class="k">Best loot</span><span class="v" style="color:${best ? RARITY_INFO[best.rarity].color : 'inherit'}">${best ? esc(best.name) : '—'}</span></div>
          <div class="stat wide"><span class="k">Score</span><span class="v">${formatInt(res.score)}${isRecord('Best score')}</span></div>
        </div>
        </div>
        <div class="res-b">
        ${
          items.length
            ? `<div><div class="section-label">${escaped ? 'YOU ESCAPED WITH' : 'LOST IN THE DARK — WHAT YOU COULD HAVE KEPT'}</div>
               <div class="item-strip ${escaped ? '' : 'lost'}">${strip}</div>
               ${escaped ? '' : `<div class="section-label">${formatInt(res.goldHeld)} GOLD · ${items.length} ITEMS · ~${formatInt(res.embers.lostItemValue)} EMBERS OF LOOT</div>`}</div>`
            : ''
        }
        <div class="embers-box">
          <div class="embers-total">${ember()}<span id="ember-count">+0</span></div>
          <div class="embers-rows">${rows}</div>
        </div>
        ${regionUnlocked ? `<div class="unlock-banner"><div class="k">NEW REGION UNLOCKED</div><div class="t">${esc(regionUnlocked)} · enter it from the Rift Portal</div></div>` : ''}
        ${unlockHint ? `<div class="unlock-banner"><div class="k">NEW UNLOCK AVAILABLE</div><div class="t">${esc(unlockHint.name)} · ${unlockHint.cost} Embers${unlockHint.vendor ? ` · ${esc(unlockHint.vendor)}` : ''}</div></div>` : ''}
        <div class="btn-row">
          <button class="btn btn-primary" data-action="start">TRY AGAIN<span class="sub">${esc(res.biomeName || '')}</span></button>
          <button class="btn ${unlockHint || regionUnlocked ? 'btn-purple' : ''}" data-action="town">${unlockHint ? 'SPEND EMBERS IN TOWN' : 'RETURN TO TOWN'}</button>
        </div>
        </div>
      </div>`);
    // Count the Embers up.
    const el = $('#ember-count', this.screen);
    const total = res.embers.total;
    const start = performance.now();
    const dur = 900;
    const step = (now) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - start) / dur);
      el.textContent = `+${formatInt(total * (1 - Math.pow(1 - t, 3)))}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    void embersBefore;
  }

  // ── Modals ────────────────────────────────────────────────
  levelUp(m, fresh = true) {
    const cards = m.choices
      .map((c, i) => {
        const u = c.upgrade;
        const rarity = u.rarity === 'common' ? 'common' : u.rarity;
        const tags = [];
        if (c.rank === 1 && u.family) tags.push('<span class="tag new">UNLOCKED</span>');
        if (c.synergy) tags.push('<span class="tag syn">SYNERGY</span>');
        if (u.rarity !== 'common') tags.push(`<span class="tag">${u.rarity.toUpperCase()}</span>`);
        return `<button class="up-card r-${rarity}" data-action="pickUpgrade" data-index="${i}">
          <div class="ic"><img src="${iconURL(u.icon, u.rarity === 'common' ? 'common' : u.rarity === 'rare' ? 'rare' : 'epic', 4)}" alt=""></div>
          <div>
            <div class="nm">${esc(u.name)}</div>
            <div class="ds">${esc(u.desc(c.rank))}</div>
            <div class="meta"><span class="pips">${u.maxRank < 20 ? pips(c.rank, u.maxRank) : ''}</span>${tags.join('')}</div>
          </div>
        </button>`;
      })
      .join('');
    this.showModal(
      `<div class="panel wide">
        <h2 class="modal-title" style="color:var(--orange-hi)">LEVEL UP</h2>
        <p class="modal-sub">Level ${m.level} · choose an upgrade</p>
        <div class="lvl-cards">${cards}</div>
        ${m.rerolls > 0 ? `<div class="btn-row"><button class="btn btn-small" data-action="reroll" style="margin:0 auto">REROLL (${m.rerolls})</button></div>` : ''}
      </div>`,
      { fresh },
    );
  }

  event(m) {
    let art = '';
    if (m.art === 'shrine') art = artURL('shrine', 5, shrineSwap(m.poi.kind));
    else if (m.art === 'mystery') art = artURL('chest', 6, { m: '#3a2350', N: '#24163a', n: '#15102a', X: '#7a3fc0', Y: '#d7a8ff' });
    if (m.result) {
      const r = m.result;
      this.showModal(
        `<div class="panel">
          <div class="event-art">${art ? `<img src="${art}" alt="">` : ''}</div>
          <div class="result-title tone-${r.tone || 'gold'}">${esc(r.title)}</div>
          <p class="event-text">${esc(r.text)}</p>
          <div class="btn-row"><button class="btn btn-primary" data-action="closeModal">CONTINUE</button></div>
        </div>`,
        { fresh: false },
      );
      return;
    }
    const choices = m.choices
      .map((c) => `<button class="btn ${c.style === 'danger' ? 'btn-danger' : c.style === 'gold' ? 'btn-gold' : ''}" data-action="eventChoice" data-choice="${c.action}" ${c.disabled ? 'disabled' : ''}>${esc(c.label)}${c.sub ? `<span class="sub">${esc(c.sub)}</span>` : ''}</button>`)
      .join('');
    this.showModal(`<div class="panel split">
      <div class="col-a">
        <h2 class="modal-title">${esc(m.title)}</h2>
        <div class="event-art">${art ? `<img src="${art}" alt="">` : ''}</div>
        <p class="event-text">${esc(m.text)}</p>
      </div>
      <div class="col-b"><div class="btn-row">${choices}</div></div>
    </div>`);
  }

  escape(run) {
    const haul = run.haul();
    const items = [...haul].sort((a, b) => RARITY_INFO[b.rarity].tier - RARITY_INFO[a.rarity].tier);
    const strip = items.slice(0, 14).map((it) => `<div class="item-chip r-${it.rarity}"><img src="${itemIconURL(it, 3)}" alt=""></div>`).join('');
    const est = run.estimateEmbers();
    const phase = phaseForTimeLeft(run.timeLeft);
    const next = PHASES[phase.id + 1];
    let risk;
    if (run.timeLeft <= 60) risk = 'The last minute: the richest loot, the deadliest dark. One wrong step and you lose it all.';
    else if (next) risk = `Stay: loot quality rises in ${formatTime(run.timeLeft - phase.until)} (${next.name.toLowerCase()}). Escaping later also pays more Embers.`;
    else risk = 'Rare loot is everywhere now — and so is death. Every second you stay pays more.';
    const otherGates = run.pois.filter((g) => g.type === 'gate' && g.open).length;
    this.showModal(`<div class="panel split">
      <div class="col-a">
      <h2 class="modal-title" style="color:var(--purple-hi)">ESCAPE?</h2>
      <p class="modal-sub">Keep your loot and end the run.</p>
      <div class="haul">
        <div class="cell"><div class="v" style="color:var(--orange-hi)">${formatInt(run.gold)}</div><div class="k">GOLD</div></div>
        <div class="cell"><div class="v">${items.length}</div><div class="k">ITEMS</div></div>
        <div class="cell"><div class="v" style="color:var(--orange-hi)">~${formatInt(est)}</div><div class="k">EMBERS</div></div>
      </div>
      ${strip ? `<div class="item-strip">${strip}</div>` : ''}
      <div class="risk-note">${esc(risk)}${otherGates <= 1 && run.timeLeft > 0 ? ' This is the last open gate.' : ''}</div>
      </div>
      <div class="col-b"><div class="btn-row">
        <button class="btn btn-primary" data-action="escape">ESCAPE<span class="sub">Secure everything</span></button>
        <button class="btn" data-action="closeModal">KEEP EXPLORING<span class="sub">${formatTime(run.timeLeft)} left on the clock</span></button>
      </div></div>
    </div>`);
  }

  merchant(run, m, fresh = true) {
    const rows = m.poi.stock
      .map((s, i) => {
        let icon;
        let name;
        let desc;
        let color = 'inherit';
        if (s.item) {
          icon = itemIconURL(s.item, 3);
          name = s.item.name;
          desc = itemLines(s.item).slice(0, 2).join(' · ');
          color = RARITY_INFO[s.item.rarity].color;
        } else if (s.kind === 'potion') {
          icon = iconURL('potion', 'common', 3);
          name = 'Health Potion';
          desc = `Restores 40% HP · you carry ${run.player.potions}/${run.player.stats.potionCapacity}`;
        } else {
          icon = iconURL('plus', 'common', 3);
          name = 'Blessing';
          desc = 'Fully restore your HP';
        }
        const full = (s.kind === 'potion' && run.player.potions >= run.player.stats.potionCapacity) || (s.kind === 'blessing' && run.player.hp >= run.player.stats.maxHp);
        const can = !s.sold && !full && run.gold >= s.price;
        return `<div class="shop-row">
          <img src="${icon}" alt="">
          <div><div class="nm" style="color:${color}">${esc(name)}</div><div class="ds">${esc(desc)}</div></div>
          <button class="btn btn-small price-btn ${can ? 'btn-gold' : ''}" data-action="buy" data-index="${i}" ${can ? '' : 'disabled'}>${s.sold ? 'SOLD' : `${s.price}g`}</button>
        </div>`;
      })
      .join('');
    this.showModal(
      `<div class="panel split wide">
        <div class="col-a">
          <h2 class="modal-title" style="color:var(--orange-hi)">${esc(m.title)}</h2>
          <p class="modal-sub">${esc(m.text)}</p>
          <div class="center" style="margin-bottom:8px"><span class="ember-pill"><img src="${iconURL('coin', 'common', 2)}" alt=""> ${formatInt(run.gold)} gold</span></div>
          <div class="btn-row only-wide"><button class="btn" data-action="closeModal">LEAVE</button></div>
        </div>
        <div class="col-b">
          <div class="shop">${rows}</div>
          <div class="hint">Gold you spend won't become Embers — but it might keep you alive.</div>
          <div class="btn-row only-tall"><button class="btn" data-action="closeModal">LEAVE</button></div>
        </div>
      </div>`,
      { fresh },
    );
  }

  pause(run) {
    const p = run.player;
    const chips = Object.entries(p.upgrades)
      .map(([id, rank]) => {
        const u = UPGRADE_BY_ID[id];
        if (!u) return '';
        return `<div class="build-chip"><img src="${iconURL(u.icon, u.rarity === 'common' ? 'common' : u.rarity === 'rare' ? 'rare' : 'epic', 2)}" alt="">${esc(u.name)} ${rank}</div>`;
      })
      .join('');
    const relics = p.relics.map((r) => `<div class="build-chip"><img src="${iconURL(r.icon, r.rarity, 2)}" alt=""><span style="color:${RARITY_INFO[r.rarity].color}">${esc(r.name)}</span></div>`).join('');
    const w = p.weapon;
    this.showModal(`<div class="panel split">
      <div class="col-a">
      <h2 class="modal-title">PAUSED</h2>
      <p class="modal-sub">${formatTime(run.timeLeft)} left · Level ${p.level} · ${formatInt(run.gold)} gold</p>
      <div class="section-label">WEAPON</div>
      <div class="build-list"><div class="build-chip"><img src="${itemIconURL(w, 2)}" alt=""><span style="color:${RARITY_INFO[w.rarity].color}">${esc(w.name)}</span> · ${Math.round(p.stats.damage)} dmg</div></div>
      ${chips ? `<div class="section-label">BUILD</div><div class="build-list">${chips}</div>` : ''}
      ${relics ? `<div class="section-label">RELICS</div><div class="build-list">${relics}</div>` : ''}
      </div>
      <div class="col-b"><div class="btn-row">
        <button class="btn btn-primary" data-action="resume">RESUME</button>
        <button class="btn" data-action="gear">EQUIPMENT</button>
        <button class="btn" data-action="settings">SETTINGS</button>
        <button class="btn btn-danger" data-action="abandonConfirm">ABANDON RUN<span class="sub">Counts as a death</span></button>
      </div></div>
    </div>`);
  }

  /** Equipment screen: what you're wearing, your stats, relics and bag. */
  gear(run, selectedUid = null) {
    const p = run.player;
    const s = p.stats;
    const slots = [
      ['helm', 'HELM', p.gear.helm, 'helm'],
      ['weapon', 'WEAPON', p.weapon, 'sword'],
      ['chest', 'CHEST', p.gear.chest, 'cuirass'],
      ['boots', 'BOOTS', p.gear.boots, 'greaves'],
    ];
    const all = [p.weapon, ...Object.values(p.gear).filter(Boolean), ...run.bag, ...p.relics];
    const selected = all.find((it) => it && it.uid === Number(selectedUid)) || p.weapon;
    const doll = canvasURL(this.sprites.playerSprites(p.gear).player_idle.r, 6);
    const slotHtml = slots
      .map(([key, label, item, emptyIcon]) => {
        const color = item ? RARITY_INFO[item.rarity].color : 'var(--line)';
        const img = item ? itemIconURL(item, 4) : iconURL(emptyIcon, 'common', 4);
        return `<button class="slot s-${key} ${item && item === selected ? 'sel' : ''}" data-action="gearSelect" data-uid="${item ? item.uid : ''}">
          <div class="box" style="border-color:${color}"><img src="${img}" alt="" style="${item ? '' : 'opacity:.25'}"></div>
          <div class="lab">${label}</div>
        </button>`;
      })
      .join('');
    const detail = selected
      ? `<div class="gear-detail"><div class="nm" style="color:${RARITY_INFO[selected.rarity].color}">${esc(selected.name)}</div>
          <div>${RARITY_INFO[selected.rarity].label} ${selected.kind === 'armor' ? selected.slot.toUpperCase() : selected.kind === 'relic' ? 'RELIC' : (selected.type || '').toUpperCase()}</div>
          ${itemLines(selected).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`
      : '';
    const stat = (k, v) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`;
    const stats = [
      stat('Damage', Math.round(s.damage)),
      stat('Attacks/s', (1 / s.attackInterval).toFixed(1)),
      stat('Crit chance', `${Math.round(s.critChance * 100)}%`),
      stat('Crit damage', `x${s.critDamage.toFixed(1)}`),
      stat('Max HP', s.maxHp),
      stat('Armor', `${s.raw.armor} (-${Math.round(s.armorReduction * 100)}%)`),
      stat('Regen', `${s.regen.toFixed(1)}/s`),
      stat('Lifesteal', `${(s.lifesteal * 100).toFixed(1)}%`),
      stat('Move speed', `${Math.round((s.moveSpeed / PLAYER_BASE.moveSpeed) * 100)}%`),
      stat('Dash', `${s.dashCooldown.toFixed(1)}s`),
    ].join('');
    const relics = p.relics.length
      ? `<div class="section-label">RELICS</div><div class="build-list">${p.relics
          .map((r) => `<button class="build-chip" data-action="gearSelect" data-uid="${r.uid}"><img src="${iconURL(r.icon, r.rarity, 2)}" alt=""><span style="color:${RARITY_INFO[r.rarity].color}">${esc(r.name)}</span></button>`)
          .join('')}</div>`
      : '';
    const bag = run.bag
      .filter((it) => it.kind === 'weapon' || it.kind === 'armor')
      .sort((a, b) => RARITY_INFO[b.rarity].tier - RARITY_INFO[a.rarity].tier)
      .map((it) => {
        const lines = itemLines(it).slice(0, 2).join(' · ');
        return `<div class="shop-row">
          <img src="${itemIconURL(it, 3)}" alt="">
          <div><div class="nm" style="color:${RARITY_INFO[it.rarity].color}">${esc(it.name)}</div><div class="ds">${esc(lines)}</div></div>
          <button class="btn btn-small" data-action="gearEquip" data-uid="${it.uid}">EQUIP</button>
        </div>`;
      })
      .join('');
    this.showModal(
      `<div class="panel split wide">
        <div class="col-a">
          <h2 class="modal-title">EQUIPMENT</h2>
          <div class="paperdoll">${slotHtml}<img class="doll" src="${doll}" alt="Your character"></div>
          ${detail}
          <div class="btn-row only-wide"><button class="btn btn-primary" data-action="gearClose">BACK TO THE FIGHT</button></div>
        </div>
        <div class="col-b">
          <div class="gear-stats">${stats}</div>
          ${relics}
          <div class="section-label" style="margin-top:6px">BAG</div>
          <div class="bag-list">${bag || '<div class="hint" style="margin:0">Items you pick up but don\'t wear go here. Escape to turn them into Embers.</div>'}</div>
          <div class="btn-row only-tall"><button class="btn btn-primary" data-action="gearClose">BACK TO THE FIGHT</button></div>
        </div>
      </div>`,
      { fresh: false },
    );
  }

  confirm(text, yesAction, noAction) {
    this.showModal(`<div class="panel">
      <h2 class="modal-title">ARE YOU SURE?</h2>
      <p class="event-text">${esc(text)}</p>
      <div class="btn-row two">
        <button class="btn" data-action="${noAction}">NO</button>
        <button class="btn btn-danger" data-action="${yesAction}">YES</button>
      </div>
    </div>`);
  }

  settings(s, backAction) {
    const toggle = (key, label) => `<div class="set-row"><span>${label}</span><button class="toggle ${s[key] ? 'on' : ''}" data-action="toggleSetting" data-key="${key}">${s[key] ? 'ON' : 'OFF'}</button></div>`;
    const slider = (key, label, min, max, step) => `<div class="set-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${s[key]}" data-setting="${key}" aria-label="${label}"></div>`;
    this.showModal(`<div class="panel wide">
      <h2 class="modal-title">SETTINGS</h2>
      <div class="settings">
        ${slider('musicVolume', 'Music volume', 0, 1, 0.05)}
        ${slider('sfxVolume', 'SFX volume', 0, 1, 0.05)}
        ${slider('sensitivity', 'Joystick sensitivity', 0.6, 1.6, 0.05)}
        ${toggle('vibration', 'Vibration')}
        ${toggle('damageNumbers', 'Damage numbers')}
        ${toggle('screenShake', 'Screen shake')}
        ${toggle('autoAttack', 'Auto-attack (one-handed)')}
        <div class="set-row"><span>Graphics quality</span><button class="toggle ${s.graphics === 'high' ? 'on' : ''}" data-action="toggleGraphics">${s.graphics === 'high' ? 'HIGH' : 'LOW'}</button></div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" data-action="${backAction}">DONE</button>
        <button class="btn btn-small btn-danger" data-action="resetConfirm" style="margin:6px auto 0">RESET PROGRESS</button>
      </div>
      <div class="hint">Keyboard: WASD move · Space attack · Shift dash · E nova · Q potion · Esc pause</div>
    </div>`);
    for (const input of this.modal.querySelectorAll('input[data-setting]')) {
      input.addEventListener('input', () => this.onAction('setSetting', { key: input.dataset.setting, value: input.value }));
    }
  }
}

function shrineSwap(kind) {
  return {
    blood: { X: '#e0384a', Y: '#8e1f2c' },
    greed: { X: '#ffd36b', Y: '#c2561f' },
    fortune: { X: '#b68cff', Y: '#4a2370' },
    haste: { X: '#8fd3ff', Y: '#1f3f7a' },
  }[kind];
}
