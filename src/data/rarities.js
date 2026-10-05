export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY_INFO = {
  common: { label: 'COMMON', color: '#b9b4cc', glow: '#8a84a6', tier: 0, statMult: 1.0, affixes: 0 },
  uncommon: { label: 'UNCOMMON', color: '#7fd65a', glow: '#4f9a3a', tier: 1, statMult: 1.12, affixes: 1 },
  rare: { label: 'RARE', color: '#5aa6ff', glow: '#2f6fd0', tier: 2, statMult: 1.28, affixes: 2 },
  epic: { label: 'EPIC', color: '#c48cff', glow: '#8f4fd6', tier: 3, statMult: 1.46, affixes: 3 },
  legendary: { label: 'LEGENDARY', color: '#ffab40', glow: '#ff7a1a', tier: 4, statMult: 1.68, affixes: 3 },
};

// Base drop weights by item level (1..4). Luck shifts weight upward.
// Legendary stays genuinely rare so finding one is a moment.
const BASE_WEIGHTS = {
  1: { common: 70, uncommon: 24, rare: 5.5, epic: 0.5, legendary: 0.0 },
  2: { common: 52, uncommon: 32, rare: 13, epic: 2.6, legendary: 0.25 },
  3: { common: 36, uncommon: 34, rare: 22, epic: 6.5, legendary: 0.9 },
  4: { common: 22, uncommon: 32, rare: 30, epic: 12.5, legendary: 2.6 },
  5: { common: 8, uncommon: 26, rare: 36, epic: 22, legendary: 6.5 },
};

/**
 * Roll a rarity.
 * @param {import('../core/rng.js').RNG} rng
 * @param {number} itemLevel 1..5
 * @param {number} luck additive luck stat (0 = none). Each point ~ +12% to rare+ weights.
 * @param {string} [minRarity] floor for the roll
 */
export function rollRarity(rng, itemLevel, luck = 0, minRarity = 'common') {
  const lvl = Math.max(1, Math.min(5, Math.round(itemLevel)));
  const w = { ...BASE_WEIGHTS[lvl] };
  const luckMult = 1 + Math.max(0, luck) * 0.12;
  w.rare *= luckMult;
  w.epic *= luckMult * luckMult;
  w.legendary *= luckMult * luckMult;
  const minTier = RARITY_INFO[minRarity].tier;
  for (const r of RARITIES) if (RARITY_INFO[r].tier < minTier) w[r] = 0;
  if (Object.values(w).every((v) => v <= 0)) return minRarity;
  return rng.weightedKey(w);
}

/** Raise a rarity by `steps`, capped at `cap` (bumps alone shouldn't mint legendaries). */
export function bumpRarity(rarity, steps = 1, cap = 'epic') {
  const capIdx = Math.max(RARITIES.indexOf(cap), RARITIES.indexOf(rarity));
  const i = Math.min(capIdx, RARITIES.indexOf(rarity) + steps);
  return RARITIES[i];
}

export function rarityTier(rarity) {
  return RARITY_INFO[rarity].tier;
}
