import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/core/rng.js';
import { rollUpgradeChoices, availableUpgrades, xpForLevel } from '../src/game/upgrades.js';
import { UPGRADES } from '../src/data/upgrades.js';
import { makeWeapon, makeRelic, salvageValue, starterWeapon } from '../src/game/items.js';
import { RELICS } from '../src/data/relics.js';
import { computeEmbers, computeScore } from '../src/game/score.js';
import { migrate, defaultSave, recordRun } from '../src/systems/save.js';
import { affordableItems, metaMods } from '../src/data/meta.js';

test('level-up offers 3 distinct, eligible upgrades', () => {
  const rng = new RNG(3);
  for (let i = 0; i < 200; i++) {
    const owned = { keen: rng.int(0, 2), vitality: 5 };
    const picks = rollUpgradeChoices(rng, owned, {}, 3);
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks.map((p) => p.upgrade.id)).size, 3);
    for (const p of picks) {
      assert.notEqual(p.upgrade.id, 'vitality', 'maxed upgrades are not offered');
      assert.ok(!p.upgrade.family, 'locked families are not offered');
      if (p.upgrade.requires) for (const [id, r] of Object.entries(p.upgrade.requires)) assert.ok((owned[id] || 0) >= r);
    }
  }
});

test('unlocking a family adds its upgrades to the pool', () => {
  const without = availableUpgrades({}, {}).map((u) => u.id);
  const withFlame = availableUpgrades({}, { flame: true }).map((u) => u.id);
  assert.ok(!without.includes('ignite'));
  assert.ok(withFlame.includes('ignite'));
  assert.ok(!withFlame.includes('inferno'), 'inferno still needs ignite first');
});

test('every upgrade describes itself at every rank', () => {
  for (const u of UPGRADES) for (let r = 1; r <= u.maxRank; r++) assert.equal(typeof u.desc(r), 'string');
});

test('xp curve grows', () => {
  for (let l = 1; l < 40; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
});

test('weapons scale with rarity and respect unlocked types', () => {
  const rng = new RNG(11);
  for (let i = 0; i < 300; i++) {
    const w = makeWeapon(rng, { rarity: 'legendary', itemLevel: 4, types: ['sword'] });
    assert.equal(w.type, 'sword');
    assert.ok(w.legendaryId);
  }
  const c = makeWeapon(rng, { rarity: 'common', itemLevel: 1, types: ['sword'] });
  const e = makeWeapon(rng, { rarity: 'epic', itemLevel: 1, types: ['sword'] });
  assert.equal(c.mods.length, 0);
  assert.equal(e.mods.length, 3);
  assert.ok(e.damage > c.damage);
  assert.equal(salvageValue(starterWeapon()), 0);
});

test('relics are not duplicated', () => {
  const rng = new RNG(5);
  const owned = [];
  for (let i = 0; i < RELICS.length; i++) {
    const r = makeRelic(rng, 'rare', owned);
    assert.ok(r);
    assert.ok(!owned.includes(r.id));
    owned.push(r.id);
  }
  assert.equal(makeRelic(rng, 'rare', owned), null);
});

test('escaping pays far more than dying; dying still pays something', () => {
  const base = { gold: 1000, goldFound: 1000, kills: 400, elites: 5, champions: 0, elapsed: 400, items: [{ rarity: 'rare' }, { rarity: 'epic' }] };
  const esc = computeEmbers({ ...base, outcome: 'escaped' });
  const died = computeEmbers({ ...base, outcome: 'died' });
  assert.ok(died.total > 0);
  assert.ok(esc.total > died.total * 2);
  const early = computeEmbers({ ...base, outcome: 'escaped', elapsed: 120 });
  assert.ok(esc.total > early.total, 'escaping later pays more');
  assert.ok(computeScore({ ...base, outcome: 'escaped' }) > computeScore({ ...base, outcome: 'died' }));
});

test('save migration fills new fields and records runs', () => {
  const s = migrate({ embers: 50, settings: { musicVolume: 0.2 } });
  assert.equal(s.embers, 50);
  assert.equal(s.settings.musicVolume, 0.2);
  assert.equal(s.settings.sfxVolume, defaultSave().settings.sfxVolume);
  assert.deepEqual(s.meta, {});
  const result = { outcome: 'escaped', kills: 10, elites: 1, champions: 0, goldFound: 100, chests: 2, elapsed: 300, items: [{ rarity: 'legendary' }], score: 999, embers: { total: 40 } };
  recordRun(s, result);
  assert.equal(s.embers, 90);
  assert.equal(s.records.bestScore, 999);
  assert.equal(s.stats.escapes, 1);
  assert.equal(s.stats.legendaries, 1);
  assert.equal(migrate(null).embers, 0);
});

test('meta helpers', () => {
  const save = defaultSave();
  save.embers = 30;
  const aff = affordableItems(save);
  assert.ok(aff.length > 0 && aff.every((a) => a.cost <= 30));
  const mods = metaMods({ might: 2 });
  assert.ok(mods.some((m) => m.stat === 'damagePct' && Math.abs(m.value - 0.1) < 1e-9));
});
