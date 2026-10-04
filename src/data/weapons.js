// Weapon bases, affixes and legendary uniques. All melee weapons share one
// attack system (an arc swing) and differ in their numbers, which is enough to
// change how a run plays: daggers dance, axes commit.

export const WEAPON_BASES = {
  sword: {
    id: 'sword',
    name: 'Sword',
    damage: 11,
    interval: 0.42,
    range: 24,
    arc: (120 * Math.PI) / 180,
    knockback: 70,
    critBonus: 0,
    sprite: 'sword',
    blurb: 'Balanced reach and speed.',
  },
  dagger: {
    id: 'dagger',
    name: 'Dagger',
    damage: 6.2,
    interval: 0.23,
    range: 18,
    arc: (90 * Math.PI) / 180,
    knockback: 30,
    critBonus: 0.1,
    sprite: 'dagger',
    blurb: 'Fast strikes, higher crit chance.',
  },
  axe: {
    id: 'axe',
    name: 'Axe',
    damage: 21,
    interval: 0.72,
    range: 28,
    arc: (170 * Math.PI) / 180,
    knockback: 120,
    critBonus: 0,
    sprite: 'axe',
    blurb: 'Slow, wide, devastating.',
  },
};

// Material names by item level give a sense of progression even for commons.
export const MATERIALS = {
  1: ['Worn', 'Iron', 'Bronze'],
  2: ['Steel', 'Tempered', 'Hunter’s'],
  3: ['Dusk', 'Grave', 'Blackened'],
  4: ['Eclipse', 'Voidforged', 'Abyssal'],
  5: ['Eclipse', 'Voidforged', 'Abyssal'],
};

// Random affixes. `roll` gives the value range at item level 1; higher levels scale up.
export const AFFIXES = [
  { id: 'dmg', stat: 'damagePct', roll: [0.06, 0.12], scale: 0.35, fmt: 'pct', label: 'Damage', prefix: 'Cruel' },
  { id: 'as', stat: 'attackSpeedPct', roll: [0.05, 0.1], scale: 0.3, fmt: 'pct', label: 'Attack Speed', prefix: 'Swift' },
  { id: 'cc', stat: 'critChance', roll: [0.03, 0.06], scale: 0.3, fmt: 'pct', label: 'Crit Chance', prefix: 'Keen' },
  { id: 'cd', stat: 'critDamage', roll: [0.15, 0.3], scale: 0.3, fmt: 'pct', label: 'Crit Damage', prefix: 'Deadly' },
  { id: 'ls', stat: 'lifesteal', roll: [0.015, 0.03], scale: 0.25, fmt: 'pct', label: 'Lifesteal', prefix: 'Vampiric' },
  { id: 'ms', stat: 'moveSpeedPct', roll: [0.04, 0.08], scale: 0.2, fmt: 'pct', label: 'Move Speed', prefix: 'Fleet' },
  { id: 'hp', stat: 'maxHp', roll: [8, 16], scale: 0.4, fmt: 'int', label: 'Max HP', prefix: 'Sturdy' },
  { id: 'burn', stat: 'burnChance', roll: [0.08, 0.14], scale: 0.25, fmt: 'pct', label: 'Burn Chance', prefix: 'Smoldering' },
  { id: 'bleed', stat: 'bleedChance', roll: [0.08, 0.14], scale: 0.25, fmt: 'pct', label: 'Bleed Chance', prefix: 'Serrated' },
  { id: 'area', stat: 'areaPct', roll: [0.06, 0.12], scale: 0.3, fmt: 'pct', label: 'Area', prefix: 'Sweeping' },
  { id: 'gold', stat: 'goldPct', roll: [0.1, 0.2], scale: 0.3, fmt: 'pct', label: 'Gold Find', prefix: 'Gilded' },
];

// Legendary uniques: fixed identity + a special effect expressed as stat mods.
export const LEGENDARIES = [
  {
    id: 'duskrender',
    base: 'sword',
    name: 'Duskrender',
    special: 'Every 4th swing releases a shadow wave.',
    mods: [
      { stat: 'shadowEvery', value: 4 },
      { stat: 'shadowCount', value: 1 },
    ],
  },
  {
    id: 'stormcaller',
    base: 'sword',
    name: 'Stormcaller',
    special: '30% chance on hit to chain lightning to 3 foes.',
    mods: [
      { stat: 'chainChance', value: 0.3 },
      { stat: 'chainCount', value: 3 },
    ],
  },
  {
    id: 'lastlight',
    base: 'sword',
    name: 'The Last Light',
    special: '+45% damage in the final 2 minutes. Pushes back the dark.',
    mods: [
      { stat: 'finalRushPct', value: 0.45 },
      { stat: 'lightPct', value: 0.4 },
    ],
  },
  {
    id: 'emberfang',
    base: 'dagger',
    name: 'Ember Fang',
    special: 'Hits ignite. Burning foes take +20% damage.',
    mods: [
      { stat: 'burnChance', value: 0.6 },
      { stat: 'burnVuln', value: 0.2 },
    ],
  },
  {
    id: 'bloodthorn',
    base: 'dagger',
    name: 'Bloodthorn',
    special: 'Hits cause bleeding. 5% lifesteal.',
    mods: [
      { stat: 'bleedChance', value: 0.5 },
      { stat: 'lifesteal', value: 0.05 },
    ],
  },
  {
    id: 'widowmaker',
    base: 'axe',
    name: 'Widowmaker',
    special: 'Kills have a 40% chance to explode.',
    mods: [
      { stat: 'explodeChance', value: 0.4 },
      { stat: 'explodePower', value: 0.6 },
    ],
  },
  {
    id: 'gravebreaker',
    base: 'axe',
    name: 'Gravebreaker',
    special: 'Every 3rd swing is a guaranteed critical hit.',
    mods: [
      { stat: 'rhythmEvery', value: 3 },
      { stat: 'critDamage', value: 0.4 },
    ],
  },
];
