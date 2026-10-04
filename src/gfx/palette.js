// Shared pixel-art palette: dark fantasy, black/purple/gray with orange accents.

export const PAL = {
  '0': '#07060c', // outline
  '1': '#15121f',
  '2': '#241e33',
  '3': '#3a3350',
  '4': '#5a5374',
  '5': '#8a84a6',
  '6': '#c9c6dc',
  '7': '#f4f2ff',
  p: '#4a2370',
  q: '#7a3fc0',
  Q: '#b68cff',
  o: '#c2561f',
  O: '#ff9a3c',
  y: '#ffd36b',
  r: '#8e1f2c',
  R: '#e0384a',
  b: '#1f3f7a',
  B: '#4f8de0',
  c: '#8fd3ff',
  g: '#1d3a26',
  G: '#2f5e34',
  l: '#6fbf4a',
  L: '#b6f06a',
  n: '#3b2618',
  N: '#6e4a2c',
  m: '#a5784a',
  s: '#e6c8a6',
  S: '#b98d6c',
  w: '#d9d2bf',
  W: '#a59f8a',
  X: '#8a84a6', // rarity accent (swapped per rarity)
  Y: '#c9c6dc', // rarity highlight
};

// Rarity accent swaps for X / Y.
export const RARITY_SWAP = {
  common: { X: '#5a5374', Y: '#c9c6dc' },
  uncommon: { X: '#2f5e34', Y: '#7fd65a' },
  rare: { X: '#1f3f7a', Y: '#5aa6ff' },
  epic: { X: '#4a2370', Y: '#c48cff' },
  legendary: { X: '#c2561f', Y: '#ffd36b' },
};

// Environment colors (forest ruins at night).
export const ENV = {
  grass: ['#16231f', '#1a2924', '#1d2e28', '#13201b'],
  grassHi: ['#24382f', '#2a4235', '#20332b'],
  moss: ['#1f3326', '#284230'],
  dirt: ['#2a2128', '#30262c', '#251d23'],
  dirtHi: ['#3c3036', '#43363a'],
  stone: ['#2a2838', '#2f2c3f', '#252333'],
  stoneHi: ['#3b3850', '#423e58'],
  stoneLine: '#1a1826',
  wallTop: ['#4a4560', '#55506d'],
  wallFace: ['#2f2b40', '#353048'],
  treeDark: '#0c1914',
  treeMid: '#132a22',
  treeLight: '#1d3d30',
  treeHi: '#2c5a44',
  treeMoon: '#3d6e63',
  trunk: '#2a1d1a',
  trunkHi: '#3d2a24',
  flowerA: '#7a3fc0',
  flowerB: '#c2561f',
  flowerC: '#c9c6dc',
};
