// Level-up choice generation. Synergy weighting nudges runs toward builds:
// upgrades sharing tags with what you own appear more often.

import { UPGRADES, EVOLUTIONS, FALLBACK_UPGRADES, UPGRADE_RARITY_WEIGHT, evolutionsUsing } from '../data/upgrades.js';

function requirementsMet(u, owned) {
  for (const [id, rank] of Object.entries(u.requires || {})) if ((owned[id] || 0) < rank) return false;
  return true;
}

/** Evolutions you qualify for and don't have yet. */
export function readyEvolutions(owned) {
  return EVOLUTIONS.filter((e) => !owned[e.id] && requirementsMet(e, owned));
}

/** The evolution an upgrade would work toward (one you don't own yet), if any. */
export function evolutionHint(u, owned) {
  const evo = evolutionsUsing(u.id).find((e) => !owned[e.id]);
  if (!evo) return null;
  const partners = Object.keys(evo.requires).filter((id) => id !== u.id);
  return { name: evo.name, partnerOwned: partners.every((id) => (owned[id] || 0) > 0) };
}

export function availableUpgrades(owned, unlocks) {
  return UPGRADES.filter((u) => {
    if (u.family && !unlocks[u.family]) return false;
    if ((owned[u.id] || 0) >= u.maxRank) return false;
    if (u.requires) for (const [id, rank] of Object.entries(u.requires)) if ((owned[id] || 0) < rank) return false;
    return true;
  });
}

function ownedTags(owned) {
  const tags = {};
  for (const u of UPGRADES) {
    const r = owned[u.id] || 0;
    if (r > 0) for (const t of u.tags) tags[t] = (tags[t] || 0) + r;
  }
  return tags;
}

/**
 * Roll `count` distinct upgrade choices.
 * @returns {Array<{upgrade:object, rank:number, synergy:boolean}>}
 */
export function rollUpgradeChoices(rng, owned, unlocks, count = 3) {
  const pool = availableUpgrades(owned, unlocks);
  const tags = ownedTags(owned);
  const weightOf = (u) => {
    let w = UPGRADE_RARITY_WEIGHT[u.rarity] || 5;
    const shared = u.tags.reduce((s, t) => s + Math.min(3, tags[t] || 0), 0);
    w *= 1 + Math.min(3, shared) * 0.45;
    if ((owned[u.id] || 0) > 0) w *= 1.2;
    if (u.family) w *= 1.15; // unlocked content should actually show up
    const hint = evolutionHint(u, owned);
    if (hint && hint.partnerOwned) w *= 1.5; // help recipes come together
    return w;
  };
  const picks = [];
  // A ready evolution always takes the first slot.
  const evo = readyEvolutions(owned)[0];
  if (evo) picks.push({ upgrade: evo, rank: 1, synergy: false, evolution: true });
  const remaining = [...pool];
  while (picks.length < count && remaining.length > 0) {
    const u = rng.weighted(remaining, weightOf);
    remaining.splice(remaining.indexOf(u), 1);
    const synergy = u.tags.some((t) => (tags[t] || 0) > 0) && (owned[u.id] || 0) === 0;
    picks.push({ upgrade: u, rank: (owned[u.id] || 0) + 1, synergy, evolvesInto: (evolutionHint(u, owned) || {}).name || null });
  }
  let f = 0;
  while (picks.length < count && f < FALLBACK_UPGRADES.length) {
    picks.push({ upgrade: FALLBACK_UPGRADES[f++], rank: 1, synergy: false });
  }
  return picks;
}

export function xpForLevel(level) {
  return Math.floor(8 + level * 5 + level * level * 1.15);
}
