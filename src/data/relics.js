// Relics are passive run items. They stack with level-up upgrades, which is
// where many builds come from. `when` makes a relic conditional.

export const RELICS = [
  { id: 'whetstone', name: 'Whetstone', rarity: 'common', icon: 'sword', desc: '+10% damage', mods: [{ stat: 'damagePct', value: 0.1 }] },
  { id: 'ironring', name: 'Iron Ring', rarity: 'common', icon: 'shield', desc: '+4 armor', mods: [{ stat: 'armor', value: 4 }] },
  { id: 'feather', name: 'Crow Feather', rarity: 'common', icon: 'feather', desc: '-18% dash cooldown', mods: [{ stat: 'dashCdPct', value: -0.18 }] },
  { id: 'heartstone', name: 'Heartstone', rarity: 'common', icon: 'heart', desc: '+20 max HP', mods: [{ stat: 'maxHp', value: 20 }] },
  { id: 'luckycoin', name: 'Lucky Coin', rarity: 'uncommon', icon: 'clover', desc: '+1 luck, +15% gold', mods: [{ stat: 'luck', value: 1 }, { stat: 'goldPct', value: 0.15 }] },
  { id: 'emberheart', name: 'Ember Heart', rarity: 'uncommon', icon: 'flame', desc: '+18% burn chance', mods: [{ stat: 'burnChance', value: 0.18 }] },
  { id: 'rustedhook', name: 'Rusted Hook', rarity: 'uncommon', icon: 'drop', desc: '+18% bleed chance', mods: [{ stat: 'bleedChance', value: 0.18 }] },
  { id: 'thornmail', name: 'Thorned Mail', rarity: 'uncommon', icon: 'shield', desc: 'Attackers take 60% of your damage', mods: [{ stat: 'thorns', value: 0.6 }, { stat: 'armor', value: 2 }] },
  { id: 'lantern', name: 'Soul Lantern', rarity: 'uncommon', icon: 'eye', desc: '+60% pickup range, see further', mods: [{ stat: 'pickupPct', value: 0.6 }, { stat: 'lightPct', value: 0.3 }] },
  { id: 'fang', name: 'Vampire Fang', rarity: 'rare', icon: 'drop', desc: '+4% lifesteal', mods: [{ stat: 'lifesteal', value: 0.04 }] },
  { id: 'hourglass', name: 'Cracked Hourglass', rarity: 'rare', icon: 'hourglass', desc: 'Final 2 min: +20% speed & attack speed', when: 'final2', mods: [{ stat: 'moveSpeedPct', value: 0.2 }, { stat: 'attackSpeedPct', value: 0.2 }] },
  { id: 'stormglass', name: 'Storm Glass', rarity: 'rare', icon: 'bolt', desc: '15% chance on hit to chain lightning', mods: [{ stat: 'chainChance', value: 0.15 }, { stat: 'chainCount', value: 2 }] },
  { id: 'chalice', name: 'Blood Chalice', rarity: 'epic', icon: 'potion', desc: 'Kills restore 1 HP', mods: [{ stat: 'lifeOnKill', value: 1 }] },
  { id: 'skulltotem', name: 'Skull Totem', rarity: 'epic', icon: 'skull', desc: '+1% damage per 8 kills this run (max 40%)', mods: [{ stat: 'killStackDamage', value: 1 }] },
  { id: 'twinblade', name: 'Spectral Twin', rarity: 'epic', icon: 'orbit', desc: '+1 orbiting spectral blade', mods: [{ stat: 'orbitBlades', value: 1 }] },
  { id: 'eclipseeye', name: 'Eye of the Eclipse', rarity: 'legendary', icon: 'eye', desc: '+15% crit chance, +60% crit damage', mods: [{ stat: 'critChance', value: 0.15 }, { stat: 'critDamage', value: 0.6 }] },
  { id: 'phoenix', name: 'Phoenix Feather', rarity: 'legendary', icon: 'feather', desc: 'Revive once at 50% HP', mods: [{ stat: 'revive', value: 1 }] },
];

export const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));
