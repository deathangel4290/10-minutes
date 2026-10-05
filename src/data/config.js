// Global tuning values. Gameplay numbers live in data files so balance can be
// changed without touching systems code.

export const TILE = 16;
export const RUN_DURATION = 600; // seconds — the "10 minutes"

// Target logical (game-pixel) width of the view in portrait. The canvas is
// rendered at this low resolution and scaled up by an integer factor.
export const TARGET_VIEW_WIDTH = 176;

// Danger phases, keyed by time REMAINING on the clock.
// Each phase sets spawn pressure, enemy mix, loot quality and mood.
export const PHASES = [
  {
    id: 0,
    until: 480, // active while timeLeft > until
    name: 'LOW DANGER',
    banner: null,
    spawnRate: [0.55, 0.85], // enemies per second at start / end of phase
    maxAlive: 26,
    eliteChance: 0,
    itemLevel: 1,
    mix: { skeleton: 5, slime: 4, wolf: 1 },
    darkness: 0.3,
    healMult: 1,
    musicIntensity: 0,
  },
  {
    id: 1,
    until: 300,
    name: 'MEDIUM DANGER',
    banner: { title: 'THE AIR GROWS COLD', sub: 'Archers join the hunt. Better loot awaits.' },
    spawnRate: [0.9, 1.4],
    maxAlive: 40,
    eliteChance: 0.015,
    itemLevel: 2,
    mix: { skeleton: 5, slime: 3, wolf: 3, archer: 1 },
    darkness: 0.36,
    healMult: 0.9,
    musicIntensity: 1,
  },
  {
    id: 2,
    until: 120,
    name: 'HIGH DANGER',
    banner: { title: 'THE ECLIPSE STIRS', sub: 'Mages and elites hunt. Healing weakens.' },
    spawnRate: [1.5, 2.2],
    maxAlive: 60,
    eliteChance: 0.025,
    itemLevel: 3,
    mix: { skeleton: 5, slime: 3, wolf: 4, archer: 2, mage: 1.3 },
    darkness: 0.42,
    healMult: 0.75,
    musicIntensity: 2,
  },
  {
    id: 3,
    until: -1,
    name: 'EXTREME DANGER',
    banner: { title: 'FINAL MINUTES', sub: 'Rare loot. Deadly foes. Healing is weak. Reach a gate.' },
    spawnRate: [2.6, 4.2],
    maxAlive: 95,
    eliteChance: 0.05,
    itemLevel: 4,
    mix: { skeleton: 4, slime: 3, wolf: 5, archer: 2.5, mage: 2.2 },
    darkness: 0.48,
    healMult: 0.6,
    musicIntensity: 3,
  },
];

export function phaseForTimeLeft(timeLeft) {
  for (const p of PHASES) if (timeLeft > p.until) return p;
  return PHASES[PHASES.length - 1];
}

/** Continuous enemy scaling by elapsed seconds (0..600). */
export function enemyScaling(elapsed) {
  const t = elapsed / RUN_DURATION;
  return {
    // The cubic terms keep the early game steady and make the last minutes brutal.
    hp: 1 + t * 2.6 + t * t * t * 5,
    damage: 1 + t * 1.1 + t * t * t * 2.2,
    speed: 1 + t * 0.12,
  };
}

// Rift gates close at these times remaining (null = stays open to the end).
export const GATE_CLOSE_TIMES = [300, 120, null];

// Scheduled world events (by time remaining).
export const SCHEDULE = {
  merchants: [430, 230],
  champion: 150,
  treasureReveals: [480, 300, 120], // extra chests spawn when phases change
};

// Player baseline before upgrades and gear.
export const PLAYER_BASE = {
  maxHp: 100,
  moveSpeed: 62,
  critChance: 0.05,
  critDamage: 1.6,
  pickupRadius: 26,
  dashCooldown: 1.3,
  dashSpeed: 230,
  dashTime: 0.16,
  energyMax: 100,
  novaCost: 50,
  energyPerHit: 3.5,
  potionHeal: 0.4,
  potionCapacity: 2,
  startingPotions: 1,
  iframes: 0.55,
};

// What escaping / dying converts into Embers (permanent currency).
export const EMBER_RULES = {
  goldRate: 0.03,
  perKill: 0.05,
  perElite: 2,
  perChampion: 40,
  perMinuteSurvived: 5,
  itemSalvage: { common: 1, uncommon: 3, rare: 8, epic: 25, legendary: 80 },
  escapeBonus: 0.2,
  deathKeep: 0.5, // fraction of the run's Embers kept on death
};
