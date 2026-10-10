// Emberfall, the town between runs. Walk up to a vendor to buy permanent
// upgrades and unlocks with Embers; step into the Rift Portal to pick a region.

export const TOWN_NAME = 'Emberfall';

export const TOWN_BIOME = {
  id: 'town',
  name: TOWN_NAME,
  size: 34,
  layout: 'town',
  gen: {},
  trees: { pine: 5, round: 4 },
  border: 'pine',
  decor: { tuft: 50, flower: 30, bush: 12, rock: 8 },
  palette: 'town',
  skin: null,
  particles: 'fireflies',
  hazard: null,
  darkness: -0.12,
  difficulty: 1,
  reward: 1,
  itemLevelBonus: 0,
  mixMult: {},
};

export const VENDORS = [
  {
    id: 'smith',
    name: 'Bram the Smith',
    label: 'BLACKSMITH',
    greeting: '"Steel and sweat. What will it be?"',
    color: '#ff9a3c',
    roof: ['#4a181d', '#5f2026', '#7a2a30'],
    sign: 'sword',
    items: [
      { kind: 'upgrade', id: 'might' },
      { kind: 'upgrade', id: 'hide' },
      { kind: 'unlock', id: 'dagger' },
      { kind: 'unlock', id: 'axe' },
    ],
    npc: { N: '#3a3350', m: '#5a5374', n: '#241e33', y: '#ff9a3c', O: '#ff9a3c' },
  },
  {
    id: 'mystic',
    name: 'Seer Ilse',
    label: 'MYSTIC',
    greeting: '"The tomes remember what the dark forgets."',
    color: '#c48cff',
    roof: ['#2a1745', '#3a1f5a', '#4f2a78'],
    sign: 'spiral',
    items: [
      { kind: 'unlock', id: 'flame' },
      { kind: 'unlock', id: 'blood' },
      { kind: 'unlock', id: 'storm' },
      { kind: 'unlock', id: 'spectral' },
      { kind: 'upgrade', id: 'wisdom' },
      { kind: 'upgrade', id: 'reroll' },
    ],
    npc: { N: '#4a2370', m: '#7a3fc0', n: '#2a1440', y: '#d7a8ff', O: '#b68cff' },
  },
  {
    id: 'alchemist',
    name: 'Old Wren',
    label: 'ALCHEMIST',
    greeting: '"A potion for every wound. Most wounds."',
    color: '#7fd65a',
    roof: ['#173a2a', '#1f4a35', '#2a6045'],
    sign: 'potion',
    items: [
      { kind: 'upgrade', id: 'vitality' },
      { kind: 'upgrade', id: 'belt' },
      { kind: 'upgrade', id: 'secondwind' },
    ],
    npc: { N: '#2f5e34', m: '#4f8a4a', n: '#1d3a26', y: '#b6f06a', O: '#7fd65a' },
  },
  {
    id: 'trader',
    name: 'Gilded Moll',
    label: 'TRADER',
    greeting: '"Fortune favors the greedy, darling."',
    color: '#ffd36b',
    roof: ['#1a2547', '#22305c', '#2e3f75'],
    sign: 'coin',
    items: [
      { kind: 'upgrade', id: 'greed' },
      { kind: 'upgrade', id: 'fortune' },
      { kind: 'upgrade', id: 'swiftness' },
    ],
    npc: null,
  },
];

export const VENDOR_BY_ID = Object.fromEntries(VENDORS.map((v) => [v.id, v]));
