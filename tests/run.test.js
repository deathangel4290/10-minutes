import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Run } from '../src/game/run.js';

const idle = { moveX: 0, moveY: 0, attack: true, dash: false, nova: false, potion: false, autoAttack: false };

function autoplay(run, seconds, input = idle) {
  for (let i = 0; i < seconds * 60 && !run.ended; i++) {
    const m = run.modal;
    if (m) {
      if (m.kind === 'levelup') run.chooseUpgrade(0);
      else run.closeModal();
    }
    run.update(1 / 60, input);
  }
}

test('a run simulates without errors and the clock runs down', () => {
  const run = new Run({ seed: 99 });
  autoplay(run, 45);
  assert.ok(run.timeLeft < 600);
  assert.ok(run.stats.kills > 0, 'the player kills things');
  assert.ok(run.enemies.length > 0);
});

test('reaching 0:00 without escaping is a death', () => {
  const run = new Run({ seed: 4 });
  run.player.stats.maxHp = 1e9;
  run.player.hp = 1e9;
  run.timeLeft = 2;
  let result = null;
  run.hooks.end = (r) => (result = r);
  autoplay(run, 5);
  assert.ok(run.ended);
  assert.equal(result.outcome, 'died');
  assert.match(result.causeTitle, /Eclipse/);
  assert.equal(result.items.length, run.haul().length);
});

test('walking into a gate offers an escape that secures loot', () => {
  const run = new Run({ seed: 8 });
  autoplay(run, 3);
  const gate = run.pois.find((p) => p.type === 'gate');
  run.enemies.length = 0;
  run.player.x = gate.x;
  run.player.y = gate.y + 2;
  run.gold = 500;
  run.update(1 / 60, idle);
  assert.equal(run.modal && run.modal.kind, 'escape');
  run.escape();
  assert.ok(run.ended);
  assert.equal(run.result.outcome, 'escaped');
  assert.ok(run.result.embers.total > 0);
});

test('closing the escape prompt does not re-open it until you step away', () => {
  const run = new Run({ seed: 8 });
  const gate = run.pois.find((p) => p.type === 'gate');
  run.player.x = gate.x;
  run.player.y = gate.y + 2;
  run.update(1 / 60, idle);
  assert.equal(run.modal.kind, 'escape');
  run.closeModal();
  run.enemies.length = 0;
  run.update(1 / 60, idle);
  assert.equal(run.modal, null);
});

test('picking up a weapon with the starter sword equips it automatically', () => {
  const run = new Run({ seed: 12 });
  const w = run.pickups.rollItem({ forceKind: 'weapon', minRarity: 'rare' });
  run.collectItem(w);
  assert.equal(run.player.weapon.uid, w.uid);
  const w2 = run.pickups.rollItem({ forceKind: 'weapon', minRarity: 'rare' });
  run.collectItem(w2);
  assert.equal(run.player.weapon.uid, w.uid, 'later weapons wait for the player to equip them');
  assert.ok(run.equipWeapon(w2.uid));
  assert.equal(run.player.weapon.uid, w2.uid);
  assert.ok(run.bag.some((it) => it.uid === w.uid), 'the old weapon stays in the bag');
});

test('dying keeps a fraction of embers and reports a cause', () => {
  const run = new Run({ seed: 21 });
  autoplay(run, 20);
  const enemy = run.enemies[0];
  run.player.iframes = 0;
  run.player.hp = 1;
  run.player.takeDamage(999, enemy);
  assert.ok(run.ended);
  assert.equal(run.result.outcome, 'died');
  assert.ok(run.result.causeTitle.startsWith('Slain by'));
});
