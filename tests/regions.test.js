import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap, T } from '../src/game/map.js';
import { BIOMES, BIOME_ORDER, biomeUnlocked } from '../src/data/biomes.js';
import { Run } from '../src/game/run.js';
import { Town } from '../src/game/town.js';
import { HUNT_TIME } from '../src/game/hazards.js';
import { makeArmor } from '../src/game/items.js';
import { RNG } from '../src/core/rng.js';
import { defaultSave, recordRun } from '../src/systems/save.js';
import { computeEmbers } from '../src/game/score.js';

const idle = { moveX: 0, moveY: 0, attack: false, dash: false, nova: false, potion: false, autoAttack: false };

function step(run, seconds, input = idle) {
  for (let i = 0; i < seconds * 60 && !run.ended; i++) {
    if (run.modal) {
      if (run.modal.kind === 'levelup') run.chooseUpgrade(0);
      else run.closeModal();
    }
    run.update(1 / 60, input);
  }
}

test('every region generates a connected map with its own terrain', () => {
  for (const id of BIOME_ORDER) {
    for (let seed = 1; seed <= 8; seed++) {
      const m = new GameMap(seed * 131, BIOMES[id]);
      assert.equal(m.n, BIOMES[id].size);
      for (const p of m.pois) assert.ok(m.isOpenReachable(p.x, p.y), `${id}: ${p.type} unreachable (seed ${seed})`);
      assert.equal(m.pois.filter((p) => p.type === 'gate').length, 3);
      const has = (t) => m.tiles.includes(t);
      if (id === 'volcano') assert.ok(has(T.LAVA), 'the caldera has lava');
      else assert.ok(!has(T.LAVA));
      if (id === 'snow') assert.ok(has(T.ICE), 'the tundra has frozen lakes');
      if (id === 'crypt') assert.ok(m.spikes.length > 0, 'the crypt has spike traps');
      else assert.equal(m.spikes.length, 0);
    }
  }
});

test('regions unlock in order by escaping the previous one', () => {
  const save = defaultSave();
  assert.ok(biomeUnlocked(save, 'forest'));
  assert.ok(!biomeUnlocked(save, 'snow'));
  const base = { kills: 1, elites: 0, champions: 0, goldFound: 0, chests: 0, elapsed: 400, items: [], score: 1, embers: { total: 1 } };
  const died = recordRun(save, { ...base, outcome: 'died', biome: 'forest' });
  assert.equal(died.regionUnlocked, null);
  const escaped = recordRun(save, { ...base, outcome: 'escaped', biome: 'forest' });
  assert.equal(escaped.regionUnlocked, 'Frozen Wastes');
  assert.ok(biomeUnlocked(save, 'snow'));
  assert.ok(!biomeUnlocked(save, 'volcano'));
  assert.equal(recordRun(save, { ...base, outcome: 'escaped', biome: 'forest' }).regionUnlocked, null, 'only the first escape announces it');
});

test('harder regions pay more embers', () => {
  const base = { outcome: 'escaped', gold: 500, kills: 200, elites: 3, champions: 0, elapsed: 400, items: [] };
  assert.ok(computeEmbers({ ...base, regionMult: 2 }).total > computeEmbers({ ...base, regionMult: 1 }).total * 1.8);
});

test('standing still gets you hunted; moving away ends it', () => {
  const run = new Run({ seed: 3 });
  run.player.stats.maxHp = run.player.hp = 1e9;
  step(run, 45 + HUNT_TIME);
  assert.ok(run.hunted, 'camping in one spot triggers the hunt');
  run.player.x += 150;
  run.map.collide(run.player);
  step(run, 0.2);
  if (run.map.isOpenReachable(run.player.x, run.player.y)) assert.ok(!run.hunted);
});

test('frostbite hurts players who stand still in the tundra', () => {
  const run = new Run({ seed: 5, biome: 'snow' });
  run.enemies.length = 0;
  run.director.update = () => {};
  const hp0 = run.player.hp;
  step(run, 7);
  assert.ok(run.frost > 4);
  assert.ok(run.player.hp < hp0, 'frost damage applied');
});

test('thorns no longer feed lifesteal, and lifesteal is capped per second', () => {
  const run = new Run({ seed: 9 });
  const p = run.player;
  p.buffs.push({ id: 'test', mods: [{ stat: 'lifesteal', value: 1 }, { stat: 'thorns', value: 5 }] });
  p.recompute();
  step(run, 1, idle);
  run.enemies.length = 0;
  const e = run.director.spawnAt('skeleton', p.x + 30, p.y, {});
  e.hp = e.maxHp = 1e6;
  p.hp = 10;
  run.combat.hitEnemy(e, 50, { source: 'thorns', noProc: true, noCrit: true });
  assert.equal(p.hp, 10, 'thorns damage does not heal');
  p.lifestealBudget = p.stats.maxHp * 0.03 + 2;
  run.combat.hitEnemy(e, 10000, { source: 'melee', noProc: true, noCrit: true });
  assert.ok(p.hp <= 10 + p.stats.maxHp * 0.03 + 2 + 1e-6, 'a single huge hit cannot fully heal you');
});

test('healing weakens in later phases but potions do not', () => {
  const run = new Run({ seed: 11 });
  const p = run.player;
  run.phase = { ...run.phase, healMult: 0.6 };
  p.hp = 10;
  p.heal(10);
  assert.equal(p.hp, 16);
  p.heal(10, true);
  assert.equal(p.hp, 26);
});

test('armor equips into empty slots, shows in the haul and swaps cleanly', () => {
  const run = new Run({ seed: 13 });
  const rng = new RNG(1);
  const a = makeArmor(rng, { rarity: 'rare', itemLevel: 2, slot: 'chest' });
  const b = makeArmor(rng, { rarity: 'epic', itemLevel: 3, slot: 'chest' });
  const armor0 = run.player.stats.raw.armor;
  run.collectItem(a);
  assert.equal(run.player.gear.chest.uid, a.uid);
  assert.ok(run.player.stats.raw.armor > armor0, 'armor applies');
  run.collectItem(b);
  assert.equal(run.player.gear.chest.uid, a.uid, 'a filled slot waits for the player');
  assert.ok(run.equipItem(b.uid));
  assert.equal(run.player.gear.chest.uid, b.uid);
  assert.ok(run.bag.some((it) => it.uid === a.uid));
  assert.ok(run.haul().some((it) => it.uid === b.uid));
});

test('archers shoot arrows and mages curse the ground', () => {
  const run = new Run({ seed: 17 });
  run.enemies.length = 0;
  run.director.update = () => {};
  const p = run.player;
  p.stats.maxHp = p.hp = 1e6;
  const archer = run.director.spawnAt('archer', p.x + 70, p.y, {});
  archer.spawnT = 0;
  archer.attackCd = 0;
  let sawArrow = false;
  for (let i = 0; i < 120; i++) {
    run.update(1 / 60, idle);
    if (run.combat.enemyProjectiles.length) sawArrow = true;
  }
  if (run.map.lineOfSight(archer.x, archer.y - 6, p.x, p.y - 6)) assert.ok(sawArrow, 'an arrow was fired');
  run.combat.addRune(p.x, p.y, 20, 0.5, 33, {});
  const hp = p.hp;
  p.iframes = 0;
  for (let i = 0; i < 40; i++) run.update(1 / 60, idle);
  assert.ok(p.hp < hp, 'the rune detonated on the player');
});

test('the town is walkable and its vendors open shops', () => {
  const town = new Town({});
  for (const poi of town.pois) if (poi.radius > 0) assert.ok(town.map.isOpenReachable(poi.x, poi.y), `${poi.type} reachable`);
  let opened = null;
  town.hooks.openModal = (m) => (opened = m);
  const v = town.pois.find((p) => p.type === 'vendor');
  town.player.x = v.x;
  town.player.y = v.y;
  town.update(1 / 60, idle);
  assert.equal(opened && opened.kind, 'vendor');
  assert.equal(opened.vendor, v.shop);
});
