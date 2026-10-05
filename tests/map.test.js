import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameMap } from '../src/game/map.js';

test('every point of interest is reachable from the spawn', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = new GameMap(seed * 7919);
    assert.ok(m.isOpenReachable(m.spawn.x, m.spawn.y), `spawn blocked (seed ${seed})`);
    for (const p of m.pois) assert.ok(m.isOpenReachable(p.x, p.y), `${p.type} unreachable (seed ${seed})`);
    assert.equal(m.pois.filter((p) => p.type === 'gate').length, 3);
    assert.ok(m.pois.filter((p) => p.type === 'chest').length >= 10);
  }
});

test('maps are deterministic per seed and differ between seeds', () => {
  const a = new GameMap(123);
  const b = new GameMap(123);
  const c = new GameMap(124);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
  assert.notDeepEqual(Array.from(a.tiles), Array.from(c.tiles));
});

test('collision keeps an entity center out of solid tiles', () => {
  const m = new GameMap(5);
  let checked = 0;
  for (let ty = 2; ty < m.n - 2 && checked < 200; ty++) {
    for (let tx = 2; tx < m.n - 2 && checked < 200; tx++) {
      if (!m.isSolid(tx, ty) || m.isSolid(tx - 1, ty)) continue;
      // Walk from the open tile on the left straight into the solid one.
      const e = { x: (tx - 1) * 16 + 8, y: ty * 16 + 8, radius: 5 };
      for (let i = 0; i < 20; i++) {
        const px = e.x;
        const py = e.y;
        e.x += 2;
        m.collide(e, px, py);
      }
      assert.ok(!m.isSolidAt(e.x, e.y), `entered solid tile at ${tx},${ty}`);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

test('flow field leads toward the target', () => {
  const m = new GameMap(77);
  m.computeFlow(m.spawn.x, m.spawn.y);
  const gate = m.pois.find((p) => p.type === 'gate');
  const dir = { x: 0, y: 0 };
  let x = gate.x;
  let y = gate.y;
  for (let i = 0; i < 4000; i++) {
    if (!m.flowDir(x, y, dir)) break;
    x += dir.x * 2;
    y += dir.y * 2;
  }
  assert.ok(Math.hypot(x - m.spawn.x, y - m.spawn.y) < 24, 'walker should arrive at the spawn');
});
