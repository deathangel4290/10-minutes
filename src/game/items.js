// Item generation: weapons with affixes, legendary uniques, relics, potions.

import { WEAPON_BASES, AFFIXES, LEGENDARIES, MATERIALS } from '../data/weapons.js';
import { RELICS } from '../data/relics.js';
import { RARITY_INFO, RARITIES } from '../data/rarities.js';
import { EMBER_RULES } from '../data/config.js';
import { STAT_LABELS } from './statLabels.js';

let uidCounter = 1;
const uid = () => uidCounter++;

export function formatMod(m) {
  const label = STAT_LABELS[m.stat];
  if (!label) return null;
  const v = m.value;
  if (label.fmt === 'pct') return `${v >= 0 ? '+' : ''}${Math.round(v * 100)}% ${label.text}`;
  if (label.fmt === 'int') return `${v >= 0 ? '+' : ''}${Math.round(v)} ${label.text}`;
  return null; // special stats are described by the item's own text
}

/**
 * @param {import('../core/rng.js').RNG} rng
 * @param {{rarity:string, itemLevel:number, types:string[], type?:string}} opts
 */
export function makeWeapon(rng, { rarity, itemLevel, types, type }) {
  const lvl = Math.max(1, Math.min(5, itemLevel));
  let legendary = null;
  if (rarity === 'legendary') {
    const pool = LEGENDARIES.filter((l) => types.includes(l.base) && (!type || l.base === type));
    legendary = rng.pick(pool.length ? pool : LEGENDARIES.filter((l) => l.base === 'sword'));
    type = legendary.base;
  }
  type = type || rng.pick(types);
  const base = WEAPON_BASES[type];
  const info = RARITY_INFO[rarity];
  const damage = base.damage * (1 + 0.17 * (lvl - 1)) * info.statMult * rng.range(0.94, 1.06);
  const interval = base.interval * rng.range(0.96, 1.04);

  const mods = [];
  const pool = rng.shuffle([...AFFIXES]);
  const affixCount = info.affixes + (rarity === 'legendary' ? 0 : 0);
  const tierBonus = 1 + info.tier * 0.12;
  for (let i = 0; i < affixCount && i < pool.length; i++) {
    const a = pool[i];
    let value = rng.range(a.roll[0], a.roll[1]) * (1 + a.scale * (lvl - 1)) * tierBonus;
    value = a.fmt === 'int' ? Math.round(value) : Math.round(value * 1000) / 1000;
    mods.push({ stat: a.stat, value, affix: a.id });
  }
  if (legendary) for (const m of legendary.mods) mods.push({ ...m });

  let name;
  if (legendary) name = legendary.name;
  else {
    const material = rng.pick(MATERIALS[lvl]);
    const prefixAffix = mods.length && rarity !== 'common' ? AFFIXES.find((a) => a.id === mods[0].affix) : null;
    name = `${prefixAffix && rarity !== 'uncommon' ? prefixAffix.prefix + ' ' : ''}${material} ${base.name}`;
  }

  return {
    kind: 'weapon',
    uid: uid(),
    type,
    rarity,
    itemLevel: lvl,
    name,
    damage: Math.round(damage * 10) / 10,
    interval,
    range: base.range,
    arc: base.arc,
    knockback: base.knockback,
    critBonus: base.critBonus,
    sprite: base.sprite,
    mods,
    special: legendary ? legendary.special : null,
    legendaryId: legendary ? legendary.id : null,
  };
}

export function starterWeapon() {
  const b = WEAPON_BASES.sword;
  return {
    kind: 'weapon',
    uid: uid(),
    type: 'sword',
    rarity: 'common',
    itemLevel: 1,
    name: 'Rusty Sword',
    damage: Math.round(b.damage * 0.9 * 10) / 10,
    interval: b.interval,
    range: b.range,
    arc: b.arc,
    knockback: b.knockback,
    critBonus: 0,
    sprite: 'sword',
    mods: [],
    special: null,
    legendaryId: null,
    starter: true,
  };
}

/** Pick a relic of the given rarity the player doesn't own yet (falls back to nearby rarities). */
export function makeRelic(rng, rarity, ownedIds = []) {
  const owned = new Set(ownedIds);
  const order = [rarity, ...RARITIES.filter((r) => r !== rarity).sort((a, b) => Math.abs(RARITY_INFO[a].tier - RARITY_INFO[rarity].tier) - Math.abs(RARITY_INFO[b].tier - RARITY_INFO[rarity].tier))];
  for (const r of order) {
    const pool = RELICS.filter((x) => x.rarity === r && !owned.has(x.id));
    if (pool.length) {
      const def = rng.pick(pool);
      return { kind: 'relic', uid: uid(), id: def.id, name: def.name, rarity: def.rarity, icon: def.icon, desc: def.desc, mods: def.mods, when: def.when || null };
    }
  }
  return null;
}

export function makePotion() {
  return { kind: 'potion', uid: uid(), name: 'Health Potion', rarity: 'common' };
}

/** Embers an item is worth when secured by escaping. */
export function salvageValue(item) {
  if (!item || item.starter || item.kind === 'potion') return 0;
  return EMBER_RULES.itemSalvage[item.rarity] || 0;
}

/** Text lines describing an item, for cards and tooltips. */
export function itemLines(item) {
  const lines = [];
  if (item.kind === 'weapon') {
    lines.push(`${Math.round(item.damage)} damage · ${(1 / item.interval).toFixed(1)} hits/s`);
    for (const m of item.mods) {
      if (item.legendaryId && !m.affix) continue;
      const t = formatMod(m);
      if (t) lines.push(t);
    }
    if (item.special) lines.push(`★ ${item.special}`);
  } else if (item.kind === 'relic') {
    lines.push(item.desc);
  } else if (item.kind === 'potion') {
    lines.push('Restores 40% HP');
  }
  return lines;
}
