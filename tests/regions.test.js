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
      assert.equal(m.pois.filter((p) => p.type === 'gate' && !p.toll).length, 3);
      assert.equal(m.pois.filter((p) => p.type === 'gate' && p.toll).length, 1, 'one toll gate');
      assert.equal(m.landmarks.length, 2, `${id}: both set pieces placed (seed ${seed})`);
      for (const b of m.pois.filter((p) => p.type === 'brazier')) assert.ok(m.isOpenReachable(b.x, b.y - 4), `${id}: brazier reachable`);
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

test('landmark templates are rectangular and orient cleanly', async () => {
  const { LANDMARKS, orient } = await import('../src/data/landmarks.js');
  for (const [region, list] of Object.entries(LANDMARKS)) {
    for (const lm of list) {
      const w = lm.rows[0].length;
      for (const r of lm.rows) assert.equal(r.length, w, `${region}/${lm.id} rows must be the same width`);
      const t = orient(lm.rows, { transpose: true, flipX: true });
      assert.equal(t.length, w);
      assert.equal(t[0].length, lm.rows.length);
      assert.ok(lm.rows.join('').includes('C'), `${region}/${lm.id} has a chest`);
    }
  }
});

test('smashing a brazier puts it out and drops loot', () => {
  const run = new Run({ seed: 21 });
  const b = run.pois.find((p) => p.type === 'brazier');
  assert.ok(b, 'the map has braziers');
  const before = run.pickups.list.length;
  assert.equal(run.combat.hitBraziers(b.x, b.y - 6, 20), 1);
  assert.equal(b.lit, false);
  assert.ok(run.pickups.list.length > before, 'loot dropped');
  assert.equal(run.combat.hitBraziers(b.x, b.y - 6, 20), 0, 'an unlit brazier cannot break again');
});

test('the toll gate takes 40% of your gold, and refuses you if you are short', () => {
  const run = new Run({ seed: 23 });
  const toll = run.pois.find((p) => p.type === 'gate' && p.toll);
  run.gold = 10;
  run.modal = { kind: 'escape', poi: toll };
  run.escape();
  assert.ok(!run.ended, 'not enough gold');
  run.gold = 500;
  run.modal = { kind: 'escape', poi: toll };
  run.escape();
  assert.ok(run.ended);
  assert.equal(run.gold, 300);
});

test('maxing a recipe offers its evolution first, and evolutions change play', async () => {
  const { rollUpgradeChoices } = await import('../src/game/upgrades.js');
  const { EVOLUTIONS, UPGRADE_BY_ID } = await import('../src/data/upgrades.js');
  const rng = new RNG(5);
  assert.ok(!rollUpgradeChoices(rng, { regen: 3, fleet: 1 }, {}, 3).some((c) => c.evolution), 'not ready yet');
  const choices = rollUpgradeChoices(rng, { regen: 4, fleet: 1 }, {}, 3);
  assert.equal(choices[0].upgrade.id, 'evo_secondwind');
  assert.ok(!rollUpgradeChoices(rng, { regen: 4, fleet: 1, evo_secondwind: 1 }, {}, 3).some((c) => c.evolution), 'only once');
  // Every recipe names real upgrades, within their max rank.
  for (const e of EVOLUTIONS) for (const [id, r] of Object.entries(e.requires)) assert.ok(UPGRADE_BY_ID[id] && r <= UPGRADE_BY_ID[id].maxRank, `${e.id}: ${id}`);

  // Second Wind: regeneration keeps going through hits while you move.
  const run = new Run({ seed: 31 });
  const p = run.player;
  p.upgrades = { regen: 4, fleet: 1, evo_secondwind: 1 };
  p.recompute();
  p.hp = 10;
  p.regenPause = 5;
  step(run, 1, { ...idle, moveX: 1 });
  assert.ok(p.hp > 10 + p.stats.regen * 2, 'triple regen while moving, even right after a hit');

  // Iron Maiden: the end of a dash hurts what's around you.
  const run2 = new Run({ seed: 33 });
  run2.director.update = () => {};
  run2.enemies.length = 0;
  const p2 = run2.player;
  p2.upgrades = { thorns: 3, bulwark: 1, evo_maiden: 1 };
  p2.recompute();
  const e = run2.director.spawnAt('skeleton', p2.x + 40, p2.y, {});
  e.spawnT = 0;
  e.hp = e.maxHp = 1e5;
  p2.facing = 1;
  run2.update(1 / 60, { ...idle, moveX: 1, dash: true });
  for (let i = 0; i < 30; i++) run2.update(1 / 60, { ...idle, moveX: 1 });
  assert.ok(e.hp < 1e5, 'spikes hit the enemy at the end of the dash');
});

test('skills: found as loot, equipped, and each one works', async () => {
  const { makeSkill } = await import('../src/game/items.js');
  const { SKILL_IDS } = await import('../src/data/skills.js');
  const rng = new RNG(3);
  for (const id of SKILL_IDS) {
    const run = new Run({ seed: 41 });
    run.director.update = () => {};
    run.enemies.length = 0;
    const p = run.player;
    p.takeDamage = () => 0;
    assert.ok(run.collectItem(makeSkill(rng, { rarity: 'rare', id })));
    assert.equal(p.skill.skill, id, `${id} auto-equips into the empty slot`);
    const foes = [];
    for (let i = 0; i < 6; i++) {
      const e = run.director.spawnAt('skeleton', p.x + 20 + i * 6, p.y + (i % 2 ? 6 : -6), {});
      e.spawnT = 0;
      e.hp = e.maxHp = 1e5;
      foes.push(e);
    }
    const hp0 = foes.reduce((a, e) => a + e.hp, 0);
    const press = { ...idle, moveX: 1, skill: true };
    if (id === 'riftanchor') {
      run.update(1 / 60, press); // drop the anchor
      assert.ok(p.anchor);
      const ax = p.anchor.x;
      for (let i = 0; i < 30; i++) run.update(1 / 60, { ...idle, moveX: -1 });
      run.update(1 / 60, press); // rip back to it
      assert.ok(!p.anchor);
      assert.ok(Math.abs(p.x - ax) < 1, 'teleported back to the anchor');
    } else {
      run.update(1 / 60, press);
      for (let i = 0; i < 90; i++) run.update(1 / 60, { ...idle, moveX: 1 });
    }
    const hp1 = foes.reduce((a, e) => a + Math.max(0, e.hp), 0);
    assert.ok(hp1 < hp0, `${id} damages foes`);
  }
});

test('Thunderstride charges come back only by travelling', async () => {
  const { makeSkill } = await import('../src/game/items.js');
  const run = new Run({ seed: 43 });
  run.director.update = () => {};
  run.enemies.length = 0;
  const p = run.player;
  run.collectItem(makeSkill(new RNG(1), { rarity: 'common', id: 'thunderstride' }));
  for (let i = 0; i < 3; i++) run.update(1 / 60, { ...idle, skill: true });
  assert.equal(p.skillCharges, 0);
  step(run, 5); // standing still
  assert.equal(p.skillCharges, 0, 'no charges from waiting');
  step(run, 3, { ...idle, moveX: 1, moveY: 0.3 });
  assert.ok(p.skillCharges > 0, 'travelling recharges it');
});

test('the first elite you kill drops a skill', () => {
  const run = new Run({ seed: 47 });
  run.director.update = () => {};
  run.enemies.length = 0;
  const p = run.player;
  const e = run.director.spawnAt('skeleton', p.x + 30, p.y, { elite: true });
  run.combat.killEnemy(e);
  assert.ok(run.pickups.list.some((pk) => pk.kind === 'item' && pk.item.kind === 'skill'));
});
