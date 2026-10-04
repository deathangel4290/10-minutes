// Permanent progression bought with Embers at the Camp.
// Upgrades are small, stackable stat bumps (power without removing challenge).
// Unlocks add new things to future runs, so the next run plays differently.

export const META_UPGRADES = [
  { id: 'vitality', name: 'Vitality', icon: 'heart', desc: '+6% starting max HP', costs: [25, 60, 110, 180, 280], mods: [{ stat: 'maxHpPct', value: 0.06 }] },
  { id: 'might', name: 'Might', icon: 'sword', desc: '+5% damage', costs: [30, 70, 130, 210, 320], mods: [{ stat: 'damagePct', value: 0.05 }] },
  { id: 'swiftness', name: 'Swiftness', icon: 'boot', desc: '+3% move speed', costs: [40, 100, 200], mods: [{ stat: 'moveSpeedPct', value: 0.03 }] },
  { id: 'hide', name: 'Tough Hide', icon: 'shield', desc: '+2 armor', costs: [45, 110, 220], mods: [{ stat: 'armor', value: 2 }] },
  { id: 'belt', name: 'Potion Belt', icon: 'potion', desc: '+1 potion capacity', costs: [90, 260], mods: [{ stat: 'potionCap', value: 1 }] },
  { id: 'fortune', name: 'Fortune', icon: 'clover', desc: '+rare loot chance', costs: [60, 130, 230, 360, 520], mods: [{ stat: 'luck', value: 0.35 }] },
  { id: 'greed', name: 'Greed', icon: 'coin', desc: '+8% gold found', costs: [20, 50, 100, 170, 260], mods: [{ stat: 'goldPct', value: 0.08 }] },
  { id: 'wisdom', name: 'Wisdom', icon: 'gem', desc: '+6% XP gained', costs: [35, 80, 140, 220, 330], mods: [{ stat: 'xpPct', value: 0.06 }] },
  { id: 'reroll', name: 'Fate Thread', icon: 'spiral', desc: '+1 upgrade reroll per run', costs: [80, 240], mods: [] },
  { id: 'secondwind', name: 'Second Wind', icon: 'feather', desc: 'Revive once per run at 50% HP', costs: [800], mods: [{ stat: 'revive', value: 1 }] },
];

export const META_UNLOCKS = [
  { id: 'dagger', name: 'Daggers', icon: 'dagger', cost: 80, desc: 'Daggers can drop: fast strikes, high crit.' },
  { id: 'flame', name: 'Tome of Flame', icon: 'flame', cost: 130, desc: 'Fire upgrades: ignite, inferno, combustion.' },
  { id: 'axe', name: 'Axes', icon: 'axe', cost: 180, desc: 'Axes can drop: slow, wide, devastating.' },
  { id: 'blood', name: 'Tome of Blood', icon: 'drop', cost: 220, desc: 'Bleed upgrades: stacking wounds, blood feast.' },
  { id: 'storm', name: 'Tome of Storms', icon: 'bolt', cost: 300, desc: 'Lightning upgrades: chains, storm surge.' },
  { id: 'spectral', name: 'Spectral Arts', icon: 'orbit', cost: 400, desc: 'Orbiting blades and the Reaper.' },
];

export const META_BY_ID = Object.fromEntries(META_UPGRADES.map((m) => [m.id, m]));
export const UNLOCK_BY_ID = Object.fromEntries(META_UNLOCKS.map((u) => [u.id, u]));

export function metaMods(metaRanks) {
  const out = [];
  for (const up of META_UPGRADES) {
    const r = metaRanks[up.id] || 0;
    for (const m of up.mods) out.push({ stat: m.stat, value: m.value * r });
  }
  return out;
}

export function nextMetaCost(up, rank) {
  return rank < up.costs.length ? up.costs[rank] : null;
}

/** Everything purchasable right now, cheapest first. */
export function affordableItems(save) {
  const list = [];
  for (const up of META_UPGRADES) {
    const cost = nextMetaCost(up, save.meta[up.id] || 0);
    if (cost !== null && cost <= save.embers) list.push({ kind: 'upgrade', id: up.id, name: up.name, cost });
  }
  for (const un of META_UNLOCKS) {
    if (!save.unlocks[un.id] && un.cost <= save.embers) list.push({ kind: 'unlock', id: un.id, name: un.name, cost: un.cost });
  }
  return list.sort((a, b) => a.cost - b.cost);
}
