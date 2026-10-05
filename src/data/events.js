// Random events / points of interest. Text and choices live here; the
// outcome logic for each `action` lives in game/events.js.

export const MYSTERY_OUTCOMES = {
  gold: 30,
  weapon: 20,
  relic: 16,
  curse: 14,
  ambush: 20,
};

export const SHRINES = {
  blood: {
    title: 'Blood Shrine',
    art: 'shrine',
    text: 'An ancient altar, slick and warm. It hungers.',
    choices: [
      { label: 'SACRIFICE 25% HP', sub: '+30% damage for the rest of the run', action: 'shrineBlood', style: 'danger' },
      { label: 'LEAVE', action: 'leave' },
    ],
  },
  greed: {
    title: 'Shrine of Greed',
    art: 'shrine',
    text: 'Coins glitter in the basin. It asks for more.',
    choices: [
      { label: 'OFFER 40% GOLD', sub: 'Receive an epic-or-better treasure', action: 'shrineGreed', style: 'gold', needsGold: true },
      { label: 'LEAVE', action: 'leave' },
    ],
  },
  fortune: {
    title: 'Shrine of Fate',
    art: 'shrine',
    text: 'A voice offers luck, at the cost of being hunted.',
    choices: [
      { label: 'ACCEPT THE MARK', sub: '+2 luck. Enemies deal +15% damage', action: 'shrineFate', style: 'danger' },
      { label: 'LEAVE', action: 'leave' },
    ],
  },
  haste: {
    title: 'Shrine of the Hunt',
    art: 'shrine',
    text: 'Wind howls through the stones. Run with it.',
    choices: [
      { label: 'EMBRACE', sub: '+15% move & attack speed. -15 max HP', action: 'shrineHaste', style: 'danger' },
      { label: 'LEAVE', action: 'leave' },
    ],
  },
};

export const MYSTERY_CHEST = {
  title: 'Mysterious Chest',
  art: 'mystery',
  text: 'A strange chest hums with violet light. Something shifts inside.',
  choices: [
    { label: 'OPEN', sub: 'Treasure... or trouble', action: 'mysteryOpen', style: 'gold' },
    { label: 'LEAVE', action: 'leave' },
  ],
};

export const MERCHANT = {
  title: 'Wandering Merchant',
  art: 'merchant',
  text: '"Gold is no use to the dead, friend. Buy something."',
};

// Merchant stock templates; prices scale with item level.
export const MERCHANT_STOCK = [
  { kind: 'potion', label: 'Health Potion', basePrice: 60 },
  { kind: 'weapon', label: 'Weapon', basePrice: 150, minRarity: 'rare' },
  { kind: 'relic', label: 'Relic', basePrice: 170, minRarity: 'uncommon' },
  { kind: 'blessing', label: 'Blessing: Full Heal', basePrice: 90 },
];

export const AMBUSH = {
  waveSize: [7, 10],
  rewardMinRarity: 'rare',
};

export const CURSED_ZONE = {
  hpMult: 1.5,
  damageMult: 1.25,
  rarityBump: 1,
  eliteChanceBonus: 0.15,
};
