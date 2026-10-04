// End-of-run rewards. Escaping late pays the most; dying still pays a little.

import { EMBER_RULES, RUN_DURATION } from '../data/config.js';
import { RARITY_INFO } from '../data/rarities.js';
import { salvageValue } from './items.js';

export function riskMultiplier(elapsed) {
  // Escaping at 0:30 left is worth far more than leaving in the first minutes.
  return 1 + Math.max(0, elapsed - 60) / (RUN_DURATION - 60);
}

export function computeEmbers({ outcome, gold, kills, elites, champions, elapsed, items }) {
  const r = EMBER_RULES;
  const rows = [];
  const add = (label, value) => {
    if (value > 0) rows.push({ label, value: Math.round(value) });
  };
  add('Gold secured', gold * r.goldRate);
  add('Enemies slain', kills * r.perKill);
  add('Elites slain', elites * r.perElite);
  add('Champion slain', champions * r.perChampion);
  add('Time survived', (elapsed / 60) * r.perMinuteSurvived);
  const itemValue = items.reduce((s, it) => s + salvageValue(it), 0);
  if (outcome === 'escaped') add('Loot salvaged', itemValue);
  const base = rows.reduce((s, x) => s + x.value, 0);
  let total;
  if (outcome === 'escaped') {
    const bonusPct = r.escapeBonus + (riskMultiplier(elapsed) - 1) * 0.3;
    const bonus = Math.round(base * bonusPct);
    rows.push({ label: `Escape bonus (+${Math.round(bonusPct * 100)}%)`, value: bonus });
    total = base + bonus;
  } else {
    total = Math.round(base * r.deathKeep);
    rows.push({ label: `Lost when you fell (-${Math.round((1 - r.deathKeep) * 100)}%)`, value: total - base, negative: true });
  }
  return { total: Math.max(outcome === 'escaped' ? 5 : 1, Math.round(total)), rows, lostItemValue: outcome === 'escaped' ? 0 : itemValue };
}

export function computeScore({ outcome, goldFound, kills, elites, champions, elapsed, items }) {
  const loot = items.reduce((s, it) => s + 40 * (RARITY_INFO[it.rarity].tier + 1) ** 2, 0);
  let score = kills * 10 + elites * 120 + champions * 1500 + goldFound + loot + Math.floor(elapsed) * 4;
  if (outcome === 'escaped') score *= 1.5 + elapsed / RUN_DURATION;
  return Math.round(score);
}
