// End-to-end playthrough in a real (headless) browser: plays through every
// screen with taps, the touch joystick and the keyboard, in portrait and
// landscape, and fails on any page error or a frozen game loop.
//
//   node tools/e2e.mjs            (needs Playwright: npm i -D playwright && npx playwright install chromium)
//
// It serves the repo itself on a free port. Some setup is done through
// window.__game (giving gold, teleporting next to a gate) to keep it fast;
// every action a player takes goes through the real UI.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Fall back to a global install (e.g. PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/).
    const base = process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/';
    return createRequire(base)('playwright');
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

const results = [];

async function playthrough(browser, base, label, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack || '').split('\n').slice(1, 4).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|ERR_CERT|ERR_NAME|fonts\.g/.test(m.text())) errors.push(m.text());
  });
  const cdp = await ctx.newCDPSession(page);
  const g = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  // Multi-touch: CDP wants every finger still on the screen in each event.
  const fingers = new Map();
  const touch = (type, x, y, id = 1) => {
    if (type === 'touchEnd') fingers.delete(id);
    else fingers.set(id, { x, y, id });
    return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.values()] });
  };

  /** The frame loop is alive if its timestamp keeps moving. */
  const alive = async () => {
    const a = await g(() => window.__game.last);
    await wait(200);
    const b = await g(() => window.__game.last);
    if (!(b > a)) throw new Error('game loop is not running');
  };
  const state = (s) => g((s) => window.__game.state === s, s).then((ok) => {
    if (!ok) throw new Error(`expected state ${s}`);
  });
  /** Drag the floating joystick (left side of the screen). */
  const joystick = async (dx, dy, ms = 600) => {
    const x = viewport.width * 0.22;
    const y = viewport.height * 0.7;
    await touch('touchStart', x, y);
    for (let i = 1; i <= 6; i++) {
      await touch('touchMove', x + (dx * i) / 6, y + (dy * i) / 6);
      await wait(20);
    }
    await wait(ms);
    await touch('touchEnd', 0, 0, 1);
  };
  const tap = async (sel) => {
    await page.locator(sel).first().waitFor({ state: 'visible', timeout: 4000 });
    // Menus ignore taps for 0.38s after they open (so a held attack thumb can't hit them).
    await page.waitForFunction(() => performance.now() - window.__game.screens.modalOpenedAt > 420);
    await page.locator(sel).first().tap();
    await wait(150);
  };
  /** Answer whatever menu the run threw up (level-ups from XP, events) through the UI. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      const kind = await g(() => window.__game.run && window.__game.run.modal && window.__game.run.modal.kind);
      if (!kind) return;
      if (kind === 'levelup') await tap('[data-action="pickUpgrade"][data-index="0"]');
      else await tap('#modal [data-action="closeModal"], #modal [data-action="eventChoice"]');
    }
  };
  const step = async (name, fn) => {
    const before = errors.length;
    let failure = null;
    try {
      await fn();
    } catch (e) {
      failure = e.message.split('\n')[0];
    }
    if (errors.length > before) failure = failure || errors.slice(before).join(' | ').split('\n')[0];
    results.push({ label, name, ok: !failure, failure });
    if (failure) console.log(`  FAIL ${label} · ${name}: ${failure}`);
  };

  await page.goto(`${base}/index.html`);
  await g(() => localStorage.clear());
  await page.reload();
  await wait(500);

  await step('title screen is up', async () => {
    await page.locator('[data-action="town"]').waitFor({ state: 'visible' });
  });
  await step('PLAY enters the town', async () => {
    await tap('[data-action="town"]');
    await wait(400);
    await state('town');
    await alive();
  });
  await step('walk around town with the joystick', async () => {
    const p0 = await g(() => ({ x: window.__game.town.player.x, y: window.__game.town.player.y }));
    await joystick(0, -60, 700);
    const p1 = await g(() => ({ x: window.__game.town.player.x, y: window.__game.town.player.y }));
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 10) throw new Error('player did not move');
  });
  await step('walk into a vendor and buy something', async () => {
    await g(() => {
      const t = window.__game.town;
      const v = t.pois.find((p) => p.shop === 'smith');
      window.__game.save.embers = 999;
      t.player.x = v.x;
      t.player.y = v.y + 30;
    });
    await page.keyboard.down('w');
    await wait(700);
    await page.keyboard.up('w');
    await page.locator('#modal [data-action="buyMeta"]:not([disabled])').first().waitFor({ state: 'visible', timeout: 3000 });
    const before = await g(() => window.__game.save.embers);
    await tap('#modal [data-action="buyMeta"]:not([disabled])');
    const after = await g(() => window.__game.save.embers);
    if (!(after < before)) throw new Error('purchase did not spend embers');
    await tap('[data-action="townClose"]:visible');
    await alive();
  });
  await step('town settings: graphics LOW and back', async () => {
    await tap('[data-town="settings"]');
    await tap('[data-action="toggleGraphics"]');
    await tap('#modal .btn-primary');
    await alive();
    await tap('[data-town="settings"]');
    await tap('[data-action="toggleGraphics"]');
    await tap('#modal .btn-primary');
    await state('town');
  });
  await step('records board', async () => {
    await g(() => {
      const t = window.__game.town;
      const b = t.pois.find((p) => p.type === 'board');
      t.player.x = b.x;
      t.player.y = b.y;
    });
    await tap('[data-action="townClose"]:visible');
  });
  await step('Rift Portal starts a run', async () => {
    await g(() => {
      const t = window.__game.town;
      const pt = t.pois.find((p) => p.type === 'portal');
      t.player.x = pt.x;
      t.player.y = pt.y + 2;
    });
    await tap('[data-action="enterRegion"][data-biome="forest"]');
    await wait(400);
    await state('run');
    await alive();
  });
  await step('fight: joystick + held attack + dash + nova + potion', async () => {
    await g(() => {
      const g = window.__game;
      g.tutorialStep = 99;
      const p = g.run.player;
      p.energy = 999;
      p.hp = Math.max(1, p.hp - 30);
    });
    const atk = await page.locator('#btn-attack').boundingBox();
    await touch('touchStart', atk.x + atk.width / 2, atk.y + atk.height / 2, 2);
    await joystick(50, 10, 800);
    await touch('touchEnd', 0, 0, 2);
    await tap('#btn-dash');
    await tap('#btn-nova');
    await tap('#btn-potion');
    await alive();
  });
  await step('level up: tap a card', async () => {
    await g(() => window.__game.run.player.addXp(80)); // two or three levels
    await wait(200);
    for (let i = 0; i < 10; i++) {
      const open = await g(() => !!window.__game.run.modal);
      if (!open) break;
      await tap('[data-action="pickUpgrade"][data-index="0"]');
    }
    if (await g(() => !!window.__game.run.modal)) throw new Error('level-up modal stuck open');
    await alive();
  });
  await step('evolution card can be picked', async () => {
    await g(() => {
      const r = window.__game.run;
      r.player.upgrades = { ...r.player.upgrades, regen: 4, fleet: 1 };
      r.player.recompute();
      r.player.pendingLevels = 1;
      r.openLevelUp();
    });
    await tap('[data-action="pickUpgrade"][data-index="0"]');
    if (!(await g(() => !!window.__game.run.player.upgrades.evo_secondwind))) throw new Error('evolution not taken');
  });
  await step('kill an elite, pick up its skill, use the Skill button', async () => {
    await g(() => {
      const r = window.__game.run;
      const p = r.player;
      const e = r.director.spawnAt('wolf', p.x + 20, p.y, { elite: true });
      r.combat.killEnemy(e);
    });
    await wait(500);
    await g(() => {
      const r = window.__game.run;
      const pk = r.pickups.list.find((q) => q.kind === 'item' && q.item.kind === 'skill');
      if (pk) {
        r.player.x = pk.x;
        r.player.y = pk.y;
      }
    });
    await wait(300);
    await settle();
    await page.locator('#btn-skill').waitFor({ state: 'visible', timeout: 3000 });
    await tap('#btn-skill');
    await wait(300);
    await tap('#btn-skill');
    await alive();
  });
  await step('every skill fires from the button', async () => {
    await settle();
    for (const id of ['bloodrush', 'thunderstride', 'riftanchor', 'wildfire']) {
      await g(async (id) => {
        const items = await import('/src/game/items.js');
        const { RNG } = await import('/src/core/rng.js');
        const r = window.__game.run;
        const it = items.makeSkill(new RNG(1), { rarity: 'rare', id });
        r.bag.push(it);
        r.equipItem(it.uid, true);
      }, id);
      await tap('#btn-skill');
      await page.keyboard.press('f');
      await wait(250);
    }
    await alive();
  });
  await step('pick up a weapon and tap EQUIP on the card', async () => {
    await settle();
    await g(() => {
      const r = window.__game.run;
      const p = r.player;
      r.pickups.dropItem(p.x, p.y, r.pickups.rollItem({ forceKind: 'weapon', minRarity: 'rare' }), 0);
    });
    await wait(500);
    const btn = page.locator('#pickup-card [data-equip]');
    if (await btn.count()) await btn.first().tap();
    await alive();
  });
  await step('equipment screen from the bag button', async () => {
    await settle();
    await tap('#btn-gear');
    await tap('[data-action="gearSelect"]');
    await tap('[data-action="gearClose"]:visible');
    await alive();
  });
  await step('pause, settings, back, resume', async () => {
    await settle();
    await tap('#btn-pause');
    await tap('[data-action="settings"]');
    await tap('#modal .btn-primary');
    await tap('[data-action="resume"]');
    await alive();
  });
  await step('keyboard: walk, attack, dash, nova, potion, skill, bag, pause', async () => {
    await settle();
    await page.keyboard.down('d');
    await page.keyboard.down(' ');
    await wait(400);
    for (const k of ['Shift', 'e', 'q', 'f']) await page.keyboard.press(k);
    await page.keyboard.up(' ');
    await page.keyboard.up('d');
    await page.keyboard.press('i');
    await wait(150);
    await page.keyboard.press('i');
    await wait(150);
    await page.keyboard.press('Escape');
    await wait(150);
    await page.keyboard.press('Escape');
    await wait(150);
    await alive();
  });
  await step('Toll Gate refuses you when short on gold', async () => {
    await g(() => (window.__game.run.enemies.length = 0));
    await settle();
    await g(() => {
      const r = window.__game.run;
      r.enemies.length = 0;
      r.gold = 5;
      const t = r.pois.find((p) => p.toll);
      r.player.x = t.x;
      r.player.y = t.y + 3;
    });
    await page.locator('[data-action="escape"]').first().waitFor({ state: 'attached', timeout: 3000 });
    if (!(await page.locator('[data-action="escape"]').first().isDisabled())) throw new Error('pay button should be disabled');
    await tap('[data-action="closeModal"]');
  });
  await step('escape through a Rift Gate -> results -> town', async () => {
    await settle();
    await g(() => {
      const r = window.__game.run;
      r.enemies.length = 0;
      const gate = r.pois.find((p) => p.type === 'gate' && p.open && !p.toll);
      r.player.x = gate.x;
      r.player.y = gate.y + 3;
    });
    await tap('[data-action="escape"]');
    await page.locator('#screen [data-action="town"]').waitFor({ state: 'visible', timeout: 6000 });
    await tap('#screen [data-action="town"]');
    await wait(300);
    await state('town');
    await alive();
    await joystick(30, 0, 300);
  });
  await step('second run: die -> results -> TRY AGAIN', async () => {
    await g(() => {
      const t = window.__game.town;
      const pt = t.pois.find((p) => p.type === 'portal');
      t.player.x = pt.x;
      t.player.y = pt.y + 2;
    });
    await tap('[data-action="enterRegion"][data-biome="forest"]');
    await wait(300);
    await g(() => {
      const p = window.__game.run.player;
      p.iframes = 0;
      p.takeDamage(1e6, null, 'Lava');
    });
    await page.locator('#screen [data-action="start"]').waitFor({ state: 'visible', timeout: 7000 });
    await tap('#screen [data-action="start"]');
    await wait(300);
    await state('run');
    await alive();
  });
  await step('rotate the device mid-run', async () => {
    await settle();
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await wait(300);
    await alive();
    await page.setViewportSize(viewport);
    await wait(300);
    await alive();
  });
  await step('abandon -> results -> town -> back to title', async () => {
    await settle();
    await tap('#btn-pause');
    await tap('[data-action="abandonConfirm"]');
    await tap('[data-action="abandon"]');
    await page.locator('#screen [data-action="town"]').waitFor({ state: 'visible', timeout: 7000 });
    await tap('#screen [data-action="town"]');
    await state('town');
    await tap('[data-town="title"]');
    await page.locator('[data-action="town"]').waitFor({ state: 'visible' });
  });
  await step('every region loads and plays for a few seconds', async () => {
    for (const biome of ['forest', 'snow', 'volcano', 'crypt']) {
      await g((b) => {
        const game = window.__game;
        game.startRun(b);
        game.tutorialStep = 99;
        game.run.player.takeDamage = () => 0;
      }, biome);
      await joystick(40, 20, 1200);
      await alive();
    }
  });

  if (errors.length) console.log(`  page errors (${label}):\n    ${errors.slice(0, 5).join('\n    ')}`);
  await ctx.close();
}

const { chromium } = await loadPlaywright();
const server = await serve();
const base = `http://localhost:${server.address().port}`;
const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
let browser;
try {
  browser = await chromium.launch(executablePath && process.env.E2E_SYSTEM_CHROMIUM ? { executablePath } : {});
  await playthrough(browser, base, 'portrait', { width: 390, height: 844 });
  await playthrough(browser, base, 'landscape', { width: 844, height: 390 });
} finally {
  if (browser) await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed${failed.length ? '' : ' — no page errors'}`);
process.exit(failed.length ? 1 : 0);
