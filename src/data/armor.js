// Armor slots: helm, chest, boots. Armor is what you "wear": it shows on the
// character and in the equipment screen, and adds armor, HP and affixes.

export const ARMOR_SLOTS = ['helm', 'chest', 'boots'];

export const ARMOR_BASES = {
  helm: { slot: 'helm', names: ['Helm', 'Hood', 'Cowl'], armor: 2, hp: 6, move: 0, icon: 'helm' },
  chest: { slot: 'chest', names: ['Cuirass', 'Mail', 'Brigandine'], armor: 4, hp: 14, move: 0, icon: 'cuirass' },
  boots: { slot: 'boots', names: ['Boots', 'Greaves', 'Treads'], armor: 1, hp: 0, move: 0.04, icon: 'greaves' },
};

export const ARMOR_MATERIALS = {
  1: ['Leather', 'Padded', 'Worn'],
  2: ['Iron', 'Studded', 'Chain'],
  3: ['Grave', 'Dusk', 'Bone'],
  4: ['Voidforged', 'Eclipse', 'Abyssal'],
  5: ['Voidforged', 'Eclipse', 'Abyssal'],
};

export const ARMOR_LEGENDARIES = [
  {
    id: 'eclipsecrown',
    slot: 'helm',
    name: 'Crown of the Eclipse',
    special: '+12% crit chance. You see further in the dark.',
    mods: [
      { stat: 'critChance', value: 0.12 },
      { stat: 'lightPct', value: 0.35 },
    ],
  },
  {
    id: 'wardenplate',
    slot: 'chest',
    name: 'Wardenplate',
    special: '+40 max HP. Attackers take 80% of your damage.',
    mods: [
      { stat: 'maxHp', value: 40 },
      { stat: 'thorns', value: 0.8 },
    ],
  },
  {
    id: 'windwalkers',
    slot: 'boots',
    name: 'Windwalkers',
    special: '+15% move speed. Dash recharges 35% faster.',
    mods: [
      { stat: 'moveSpeedPct', value: 0.15 },
      { stat: 'dashCdPct', value: -0.35 },
    ],
  },
];

// How armor of each rarity tints the character sprite.
export const ARMOR_TINTS = {
  common: ['#4a4560', '#6e6890'],
  uncommon: ['#2f5e34', '#5f9a4a'],
  rare: ['#1f3f7a', '#4f8de0'],
  epic: ['#4a2370', '#8f4fd6'],
  legendary: ['#c2561f', '#ffd36b'],
};
