import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/core/rng.js';
import { rollRarity, bumpRarity } from '../src/data/rarities.js';
import { sumMods, computePlayerStats } from '../src/game/stats.js';
import { ART, ICONS } from '../src/gfx/art.js';
import { PAL } from '../src/gfx/palette.js';
import { formatTime } from '../src/core/math.js';

test('RNG is deterministic per seed', () => {
  const a = new RNG(42);
  const b = new RNG(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const c = new RNG(43);
  assert.notEqual(new RNG(42).next(), c.next());
});

test('RNG helpers stay in range', () => {
  const r = new RNG(1);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
  assert.equal(r.weighted([1, 2, 3], () => 0), null);
});

test('legendaries never drop at item level 1 and stay rare later', () => {
  const r = new RNG(7);
  let legend = 0;
  for (let i = 0; i < 5000; i++) if (rollRarity(r, 1, 0) === 'legendary') legend++;
  assert.equal(legend, 0);
  legend = 0;
  for (let i = 0; i < 20000; i++) if (rollRarity(r, 4, 0) === 'legendary') legend++;
  const rate = legend / 20000;
  assert.ok(rate > 0.01 && rate < 0.05, `legendary rate ${rate}`);
});

test('rarity floor and bump cap', () => {
  const r = new RNG(9);
  for (let i = 0; i < 500; i++) assert.notEqual(rollRarity(r, 1, 0, 'rare'), 'common');
  assert.equal(bumpRarity('rare', 1), 'epic');
  assert.equal(bumpRarity('epic', 1), 'epic', 'bumps alone cannot create legendaries');
  assert.equal(bumpRarity('epic', 1, 'legendary'), 'legendary');
  assert.equal(bumpRarity('legendary', 1), 'legendary');
});

test('stat mods add up, "every N" stats take the lowest', () => {
  const s = sumMods([[{ stat: 'damagePct', value: 0.1 }, { stat: 'shadowEvery', value: 5 }], [{ stat: 'damagePct', value: 0.2 }, { stat: 'shadowEvery', value: 3 }]]);
  assert.ok(Math.abs(s.damagePct - 0.3) < 1e-9);
  assert.equal(s.shadowEvery, 3);
  const weapon = { damage: 10, interval: 0.5, range: 20, arc: 2, knockback: 50, critBonus: 0, mods: [] };
  const st = computePlayerStats(weapon, [[{ stat: 'damagePct', value: 0.5 }, { stat: 'attackSpeedPct', value: 1 }]]);
  assert.equal(st.damage, 15);
  assert.equal(st.attackInterval, 0.25);
});

test('all pixel art rows are rectangular and use palette colors', () => {
  for (const set of [ART, ICONS]) {
    for (const [name, rows] of Object.entries(set)) {
      const w = rows[0].length;
      for (const row of rows) {
        assert.equal(row.length, w, `${name} has a ragged row`);
        for (const ch of row) assert.ok(ch === '.' || ch in PAL, `${name} uses unknown color '${ch}'`);
      }
    }
  }
});

test('formatTime', () => {
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(61), '1:01');
  assert.equal(formatTime(0.2), '0:01');
  assert.equal(formatTime(-3), '0:00');
});
