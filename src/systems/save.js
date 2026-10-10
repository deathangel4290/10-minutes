// Local save data. Everything permanent lives here and is written on every
// change, so closing the app never loses progression. A run in progress
// keeps a small "salvage" snapshot so an interrupted run still pays out.

import { BIOMES, BIOME_ORDER } from '../data/biomes.js';

const KEY = 'last10min.save.v1';
const VERSION = 1;

export const DEFAULT_SETTINGS = {
  musicVolume: 0.7,
  sfxVolume: 0.8,
  vibration: true,
  damageNumbers: true,
  screenShake: true,
  graphics: 'high', // 'high' | 'low'
  sensitivity: 1,
  autoAttack: false,
};

export function defaultSave() {
  return {
    version: VERSION,
    embers: 0,
    totalEmbers: 0,
    meta: {},
    unlocks: {},
    records: { bestScore: 0, bestSurvival: 0, bestEscapeTime: 0, mostGold: 0, mostKills: 0 },
    stats: { runs: 0, escapes: 0, deaths: 0, kills: 0, elites: 0, champions: 0, goldFound: 0, legendaries: 0, chests: 0, playSeconds: 0 },
    settings: { ...DEFAULT_SETTINGS },
    tutorialDone: false,
    pendingRun: null,
    seenUnlocks: [],
    regions: {},
    townTutorialDone: false,
  };
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Merge loaded data over defaults so new fields appear after updates. */
export function migrate(data) {
  const base = defaultSave();
  if (!data || typeof data !== 'object') return base;
  return {
    ...base,
    ...data,
    version: VERSION,
    meta: { ...base.meta, ...(data.meta || {}) },
    unlocks: { ...base.unlocks, ...(data.unlocks || {}) },
    records: { ...base.records, ...(data.records || {}) },
    stats: { ...base.stats, ...(data.stats || {}) },
    settings: { ...base.settings, ...(data.settings || {}) },
    seenUnlocks: Array.isArray(data.seenUnlocks) ? data.seenUnlocks : [],
    regions: { ...base.regions, ...(data.regions || {}) },
  };
}

export function loadSave() {
  const s = storage();
  if (!s) return defaultSave();
  try {
    const raw = s.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(save) {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Apply a finished run's results to the save. Returns what changed (for the results screen). */
export function recordRun(save, result) {
  const st = save.stats;
  const rec = save.records;
  const newRecords = [];
  st.runs++;
  if (result.outcome === 'escaped') st.escapes++;
  else st.deaths++;
  st.kills += result.kills;
  st.elites += result.elites;
  st.champions += result.champions;
  st.goldFound += result.goldFound;
  st.chests += result.chests;
  st.playSeconds += Math.round(result.elapsed);
  st.legendaries += result.items.filter((i) => i.rarity === 'legendary').length;

  if (result.score > rec.bestScore) {
    if (rec.bestScore > 0) newRecords.push('Best score');
    rec.bestScore = result.score;
  }
  if (result.elapsed > rec.bestSurvival) {
    if (rec.bestSurvival > 0) newRecords.push('Longest survival');
    rec.bestSurvival = Math.round(result.elapsed);
  }
  if (result.outcome === 'escaped' && result.elapsed > rec.bestEscapeTime) {
    rec.bestEscapeTime = Math.round(result.elapsed);
  }
  if (result.goldFound > rec.mostGold) rec.mostGold = result.goldFound;
  if (result.kills > rec.mostKills) rec.mostKills = result.kills;

  // Regions: escaping one opens the next.
  let regionUnlocked = null;
  const id = result.biome || 'forest';
  const reg = (save.regions[id] = save.regions[id] || { escapes: 0, runs: 0, best: 0 });
  reg.runs++;
  if (result.outcome === 'escaped') {
    reg.escapes++;
    reg.best = Math.max(reg.best, Math.round(result.elapsed));
    if (reg.escapes === 1) {
      const next = BIOME_ORDER.find((b) => BIOMES[b].unlockedBy === id);
      if (next) regionUnlocked = BIOMES[next].name;
    }
  }

  save.embers += result.embers.total;
  save.totalEmbers += result.embers.total;
  save.pendingRun = null;
  return { newRecords, regionUnlocked };
}
