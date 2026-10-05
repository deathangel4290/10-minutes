// Stat aggregation. Upgrades, relics, weapon affixes, permanent upgrades and
// temporary buffs all describe themselves as a list of { stat, value } mods.
// Stats are recomputed only when one of those sources changes.

import { PLAYER_BASE } from '../data/config.js';

// Every stat a mod can touch, with its neutral value. Mods are additive.
export const STAT_DEFAULTS = {
  maxHp: 0,
  maxHpPct: 0,
  damagePct: 0,
  attackSpeedPct: 0,
  moveSpeedPct: 0,
  critChance: 0,
  critDamage: 0,
  armor: 0,
  regen: 0,
  lifesteal: 0,
  lifeOnKill: 0,
  pickupPct: 0,
  areaPct: 0,
  goldPct: 0,
  xpPct: 0,
  luck: 0,
  dashCdPct: 0,
  energyPct: 0,
  thorns: 0,
  burnChance: 0,
  burnPower: 0,
  burnVuln: 0,
  bleedChance: 0,
  bleedPower: 0,
  bleedVuln: 0,
  chainChance: 0,
  chainCount: 0,
  shadowEvery: 0, // lowest non-zero wins
  shadowCount: 0,
  rhythmEvery: 0, // lowest non-zero wins: every Nth swing is a guaranteed crit
  orbitBlades: 0,
  explodeChance: 0,
  explodePower: 0,
  critNova: 0,
  dashStrike: 0,
  dashShield: 0,
  novaPct: 0,
  potionCap: 0,
  executeThreshold: 0,
  killStackDamage: 0,
  finalRushPct: 0,
  revive: 0,
  lightPct: 0,
};

const MIN_STATS = new Set(['shadowEvery', 'rhythmEvery']);

export function sumMods(modLists) {
  const s = { ...STAT_DEFAULTS };
  for (const list of modLists) {
    if (!list) continue;
    for (const m of list) {
      if (!(m.stat in s)) {
        console.warn('Unknown stat', m.stat);
        continue;
      }
      if (MIN_STATS.has(m.stat)) {
        s[m.stat] = s[m.stat] === 0 ? m.value : Math.min(s[m.stat], m.value);
      } else {
        s[m.stat] += m.value;
      }
    }
  }
  return s;
}

/**
 * Build the final player stat block.
 * @param {object} weapon equipped weapon item (see items.js)
 * @param {Array<Array<{stat:string,value:number}>>} modLists
 */
export function computePlayerStats(weapon, modLists) {
  const m = sumMods(modLists);
  const base = PLAYER_BASE;
  const maxHp = Math.round((base.maxHp + m.maxHp) * (1 + m.maxHpPct));
  return {
    raw: m,
    maxHp: Math.max(1, maxHp),
    moveSpeed: base.moveSpeed * Math.max(0.4, 1 + m.moveSpeedPct),
    damage: weapon.damage * Math.max(0.1, 1 + m.damagePct),
    attackInterval: weapon.interval / Math.max(0.3, 1 + m.attackSpeedPct),
    range: weapon.range * (1 + m.areaPct * 0.6),
    arc: Math.min(Math.PI * 1.9, weapon.arc * (1 + m.areaPct * 0.5)),
    knockback: weapon.knockback,
    critChance: Math.min(0.95, base.critChance + (weapon.critBonus || 0) + m.critChance),
    critDamage: base.critDamage + m.critDamage,
    armorReduction: m.armor > 0 ? Math.min(0.6, m.armor / (m.armor + 30)) : 0,
    regen: m.regen,
    lifesteal: m.lifesteal,
    pickupRadius: base.pickupRadius * (1 + m.pickupPct),
    dashCooldown: base.dashCooldown * Math.max(0.35, 1 + m.dashCdPct),
    energyGain: base.energyPerHit * (1 + m.energyPct),
    novaRadius: 46 * (1 + m.areaPct * 0.6),
    novaDamageMult: 2.2 * (1 + m.novaPct),
    potionCapacity: base.potionCapacity + m.potionCap,
    lightRadius: 78 * (1 + m.lightPct),
  };
}

/** Rough damage-per-second figure used for comparing weapons in the UI. */
export function weaponDps(weapon, critChance = 0.05, critDamage = 1.6) {
  const cc = Math.min(0.95, critChance + (weapon.critBonus || 0));
  return (weapon.damage / weapon.interval) * (1 + cc * (critDamage - 1));
}
