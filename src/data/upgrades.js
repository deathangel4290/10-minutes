// Level-up upgrades. Each rank applies `mods` once more (or `modsAt(rank)`
// for non-linear upgrades). `tags` drive synergy weighting so builds form:
// owning crit upgrades makes more crit upgrades show up.
// `family` gates an upgrade behind a permanent unlock (see meta.js).

const pct = (v) => `${Math.round(v * 100)}%`;
const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

export const UPGRADES = [
  // ── Core ─────────────────────────────────────────────
  { id: 'vitality', name: 'Vitality', icon: 'heart', rarity: 'common', tags: ['tank'], maxRank: 5,
    desc: () => '+20 Max HP and heal 20', mods: [{ stat: 'maxHp', value: 20 }] },
  { id: 'sharpen', name: 'Sharpened Edge', icon: 'sword', rarity: 'common', tags: ['damage'], maxRank: 5,
    desc: () => '+14% damage', mods: [{ stat: 'damagePct', value: 0.14 }] },
  { id: 'frenzy', name: 'Frenzy', icon: 'bolt', rarity: 'common', tags: ['speed'], maxRank: 5,
    desc: () => '+12% attack speed', mods: [{ stat: 'attackSpeedPct', value: 0.12 }] },
  { id: 'fleet', name: 'Fleet Foot', icon: 'boot', rarity: 'common', tags: ['mobility'], maxRank: 3,
    desc: () => '+10% move speed', mods: [{ stat: 'moveSpeedPct', value: 0.1 }] },
  { id: 'keen', name: 'Keen Eye', icon: 'crit', rarity: 'common', tags: ['crit'], maxRank: 5,
    desc: () => '+7% critical chance', mods: [{ stat: 'critChance', value: 0.07 }] },
  { id: 'executioner', name: 'Executioner', icon: 'skull', rarity: 'rare', tags: ['crit'], maxRank: 4,
    desc: () => '+35% critical damage', mods: [{ stat: 'critDamage', value: 0.35 }] },
  { id: 'rhythm', name: 'Deadly Rhythm', icon: 'crit', rarity: 'epic', tags: ['crit'], maxRank: 3, requires: { keen: 1 },
    desc: (r) => `Every ${ordinal(6 - r)} swing is a guaranteed crit`,
    modsAt: (r) => [{ stat: 'rhythmEvery', value: 6 - r }] },
  { id: 'shatter', name: 'Shatterpoint', icon: 'star', rarity: 'epic', tags: ['crit', 'area'], maxRank: 3, requires: { keen: 2 },
    desc: () => 'Crits release a shockwave (+40% power per rank)', mods: [{ stat: 'critNova', value: 0.4 }] },
  { id: 'reach', name: 'Wide Arc', icon: 'arc', rarity: 'common', tags: ['area'], maxRank: 4,
    desc: () => '+15% attack size', mods: [{ stat: 'areaPct', value: 0.15 }] },
  { id: 'regen', name: 'Regeneration', icon: 'plus', rarity: 'common', tags: ['tank'], maxRank: 4,
    desc: () => 'Regenerate +0.8 HP per second', mods: [{ stat: 'regen', value: 0.8 }] },
  { id: 'ironskin', name: 'Iron Skin', icon: 'shield', rarity: 'common', tags: ['tank'], maxRank: 5,
    desc: () => '+5 armor (reduces damage taken)', mods: [{ stat: 'armor', value: 5 }] },
  { id: 'thorns', name: 'Thorns', icon: 'thorn', rarity: 'rare', tags: ['tank'], maxRank: 3,
    desc: () => 'Attackers take 50% of your damage', mods: [{ stat: 'thorns', value: 0.5 }] },
  { id: 'bloodthirst', name: 'Bloodthirst', icon: 'drop', rarity: 'rare', tags: ['tank', 'damage'], maxRank: 3,
    desc: () => '+2.5% lifesteal', mods: [{ stat: 'lifesteal', value: 0.025 }] },
  { id: 'magnet', name: 'Soul Magnet', icon: 'magnet', rarity: 'common', tags: ['loot'], maxRank: 3,
    desc: () => '+45% pickup range', mods: [{ stat: 'pickupPct', value: 0.45 }] },
  { id: 'greed', name: 'Greed', icon: 'coin', rarity: 'common', tags: ['loot'], maxRank: 3,
    desc: () => '+25% gold found', mods: [{ stat: 'goldPct', value: 0.25 }] },
  { id: 'wisdom', name: 'Wisdom', icon: 'gem', rarity: 'common', tags: ['loot'], maxRank: 3,
    desc: () => '+18% XP gained', mods: [{ stat: 'xpPct', value: 0.18 }] },
  { id: 'fortune', name: 'Fortune', icon: 'clover', rarity: 'rare', tags: ['loot'], maxRank: 3,
    desc: () => '+1 luck (better loot rarity)', mods: [{ stat: 'luck', value: 1 }] },
  { id: 'shadowwave', name: 'Shadow Wave', icon: 'spiral', rarity: 'rare', tags: ['shadow', 'damage'], maxRank: 3,
    desc: (r) => (r === 1 ? 'Every 5th swing releases a piercing shadow wave' : '+1 shadow wave, fires more often'),
    modsAt: (r) => [{ stat: 'shadowEvery', value: Math.max(3, 6 - r) }, { stat: 'shadowCount', value: r }] },
  { id: 'phantomdash', name: 'Phantom Dash', icon: 'feather', rarity: 'rare', tags: ['mobility', 'damage'], maxRank: 3,
    desc: () => 'Dashing through enemies deals 120% damage', mods: [{ stat: 'dashStrike', value: 1.2 }] },
  { id: 'quickstep', name: 'Quickstep', icon: 'boot', rarity: 'common', tags: ['mobility'], maxRank: 3,
    desc: () => '-20% dash cooldown', mods: [{ stat: 'dashCdPct', value: -0.2 }] },
  { id: 'bulwark', name: 'Bulwark', icon: 'shield', rarity: 'rare', tags: ['tank', 'mobility'], maxRank: 3,
    desc: () => 'Dashing grants a shield that absorbs 15 damage', mods: [{ stat: 'dashShield', value: 15 }] },
  { id: 'novapower', name: 'Eclipse Nova', icon: 'nova', rarity: 'rare', tags: ['nova', 'area'], maxRank: 3,
    desc: () => '+45% Nova damage, +12% size', mods: [{ stat: 'novaPct', value: 0.45 }, { stat: 'areaPct', value: 0.05 }] },
  { id: 'siphon', name: 'Soul Siphon', icon: 'gem', rarity: 'common', tags: ['nova'], maxRank: 3,
    desc: () => '+35% energy from hits', mods: [{ stat: 'energyPct', value: 0.35 }] },

  // ── Tome of Flame ────────────────────────────────────
  { id: 'ignite', family: 'flame', name: 'Ember Edge', icon: 'flame', rarity: 'common', tags: ['fire'], maxRank: 4,
    desc: () => '+20% chance to ignite enemies', mods: [{ stat: 'burnChance', value: 0.2 }] },
  { id: 'inferno', family: 'flame', name: 'Inferno', icon: 'flame', rarity: 'rare', tags: ['fire'], maxRank: 3, requires: { ignite: 1 },
    desc: () => '+60% burn damage', mods: [{ stat: 'burnPower', value: 0.6 }] },
  { id: 'kindling', family: 'flame', name: 'Kindling', icon: 'flame', rarity: 'rare', tags: ['fire', 'damage'], maxRank: 3, requires: { ignite: 1 },
    desc: () => 'Burning enemies take +12% damage', mods: [{ stat: 'burnVuln', value: 0.12 }] },
  { id: 'combustion', family: 'flame', name: 'Combustion', icon: 'nova', rarity: 'epic', tags: ['fire', 'area'], maxRank: 3, requires: { ignite: 2 },
    desc: () => 'Kills have +15% chance to explode', mods: [{ stat: 'explodeChance', value: 0.15 }, { stat: 'explodePower', value: 0.25 }] },

  // ── Tome of Blood ────────────────────────────────────
  { id: 'serrated', family: 'blood', name: 'Serrated', icon: 'drop', rarity: 'common', tags: ['bleed'], maxRank: 4,
    desc: () => '+20% chance to cause bleeding (stacks)', mods: [{ stat: 'bleedChance', value: 0.2 }] },
  { id: 'hemorrhage', family: 'blood', name: 'Hemorrhage', icon: 'drop', rarity: 'rare', tags: ['bleed'], maxRank: 3, requires: { serrated: 1 },
    desc: () => '+60% bleed damage', mods: [{ stat: 'bleedPower', value: 0.6 }] },
  { id: 'openwounds', family: 'blood', name: 'Open Wounds', icon: 'skull', rarity: 'rare', tags: ['bleed', 'damage'], maxRank: 3, requires: { serrated: 1 },
    desc: () => 'Bleeding enemies take +12% damage', mods: [{ stat: 'bleedVuln', value: 0.12 }] },
  { id: 'bloodfeast', family: 'blood', name: 'Blood Feast', icon: 'heart', rarity: 'epic', tags: ['bleed', 'tank'], maxRank: 2, requires: { serrated: 2 },
    desc: () => 'Kills restore 1 HP', mods: [{ stat: 'lifeOnKill', value: 1 }] },

  // ── Tome of Storms ───────────────────────────────────
  { id: 'static', family: 'storm', name: 'Static Charge', icon: 'bolt', rarity: 'common', tags: ['storm'], maxRank: 4,
    desc: () => '+12% chance on hit to chain lightning', mods: [{ stat: 'chainChance', value: 0.12 }, { stat: 'chainCount', value: 1 }] },
  { id: 'conductor', family: 'storm', name: 'Conductor', icon: 'bolt', rarity: 'rare', tags: ['storm'], maxRank: 3, requires: { static: 1 },
    desc: () => 'Lightning chains to +2 more enemies', mods: [{ stat: 'chainCount', value: 2 }] },
  { id: 'stormsurge', family: 'storm', name: 'Storm Surge', icon: 'nova', rarity: 'epic', tags: ['storm', 'nova'], maxRank: 2, requires: { static: 2 },
    desc: () => '+60% energy gain, +30% Nova damage', mods: [{ stat: 'energyPct', value: 0.6 }, { stat: 'novaPct', value: 0.3 }] },

  // ── Spectral Arts ────────────────────────────────────
  { id: 'spectral', family: 'spectral', name: 'Spectral Blade', icon: 'orbit', rarity: 'rare', tags: ['spectral', 'area'], maxRank: 4,
    desc: () => '+1 blade orbits you, cutting foes', mods: [{ stat: 'orbitBlades', value: 1 }] },
  { id: 'reaper', family: 'spectral', name: 'Reaper', icon: 'skull', rarity: 'epic', tags: ['spectral', 'damage'], maxRank: 2, requires: { spectral: 1 },
    desc: (r) => `Execute normal enemies below ${pct(0.12 * r)} HP`, mods: [{ stat: 'executeThreshold', value: 0.12 }] },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

// Offered when the pool runs dry so a level-up is never empty.
export const FALLBACK_UPGRADES = [
  { id: 'rations', name: 'Field Rations', icon: 'potion', rarity: 'common', tags: [], maxRank: 99,
    desc: () => 'Heal 35% of max HP', mods: [], onPick: { healPct: 0.35 } },
  { id: 'pouch', name: 'Coin Pouch', icon: 'coin', rarity: 'common', tags: [], maxRank: 99,
    desc: () => 'Gain 120 gold', mods: [], onPick: { gold: 120 } },
];

export const UPGRADE_RARITY_WEIGHT = { common: 10, rare: 5.5, epic: 2.6 };

export function upgradeMods(upgrade, rank) {
  if (rank <= 0) return [];
  if (upgrade.modsAt) return upgrade.modsAt(rank);
  return upgrade.mods.map((m) => ({ stat: m.stat, value: m.value * rank }));
}
