# Last 10 Minutes

**Survive · Loot · Escape · or risk it all.**

A dark-fantasy pixel-art roguelike built for phones in portrait mode. Every run is exactly ten minutes long. You start with a rusty sword, scavenge for better weapons and relics, level up into a build, and decide when to leave through a Rift Gate. Staying longer means better loot and more Embers, until the clock hits 0:00 and the eclipse takes everything you carried.

This is the first playable prototype. It focuses on the core "one more run" loop:

- **10-minute runs** with four danger phases. The world gets darker and more crowded as the clock runs down.
- **Risk/reward extraction.** Three Rift Gates, two of which collapse at 5:00 and 2:00. Escaping later pays more, and reaching 0:00 means you lose your loot.
- **Combat:** a floating joystick, hold-to-attack with auto-aim, a dash with i-frames, an energy-powered Eclipse Nova, and potions. Hit-stop, screen shake, crits and telegraphed enemy attacks make it feel good to play.
- **Three enemy types, each with its own behavior**, plus elites and a late-game champion. Skeletons (a melee wind-up you can interrupt), Slimes (they hop and split), and Wolves (they circle and lunge). Elites are tougher versions with better drops, and the **Bone Colossus** appears at 2:30 and guards legendary loot.
- **Loot:** five rarities, weapons with random affixes (swords, plus unlockable daggers and axes), seven legendary uniques with special effects, and 17 relics. Legendary drops get a light beam, a banner and their own sound.
- **Level-ups** pause the game and offer three upgrades. There are 36 upgrades across five build families (crit, fire, bleed, lightning, spectral), and synergy weighting helps builds come together.
- **Random events:** Mysterious Chests (treasure, a curse or an ambush), four kinds of shrine, Wandering Merchants, hidden ambush sites, a guarded treasure room, a cursed zone and enemy camps.
- **Permanent progression:** Embers buy stat upgrades and unlock new weapon types and upgrade families, so the next run plays differently. Dying still keeps 50% of the run's non-loot Embers.
- **Results screen:** cause of death, everything you lost, a breakdown of Embers earned, and a "NEW UNLOCK AVAILABLE" prompt. **TRY AGAIN** starts the next run immediately.
- **Saves and settings** live in local storage. The game also autosaves a salvage snapshot, so closing the app mid-run doesn't wipe it.
- **Audio** is fully synthesized with WebAudio. The music adds layers and speeds up with each danger phase.
- It's an **installable PWA** with offline support and portrait lock.

## Running it

It has no dependencies and no build step: plain ES modules, served as static files.

```bash
npm start            # serves the folder on http://localhost:8080 (uses npx http-server)
# or any static server, e.g. python3 -m http.server 8080
```

Open the URL on your phone (same Wi-Fi), or in a desktop browser with mobile emulation. ES modules don't load from `file://`, so serve the folder over HTTP.

### Controls

| Touch | Keyboard | Action |
| --- | --- | --- |
| Drag on the left side | WASD / arrows | Move (floating joystick) |
| Hold the sword button | Space / J | Attack (auto-aims at the nearest enemy) |
| Chevron button | Shift / K | Dash (brief invulnerability) |
| Nova button (fills with energy) | E / L | Eclipse Nova: area blast, costs 50 energy |
| Potion button | Q / H | Drink a potion (heals 40%) |
| II | Esc / P | Pause |

Settings include an **auto-attack (one-handed)** mode.

## Development

```bash
npm test             # unit tests (node:test): RNG, maps, loot, upgrades, economy, saves, run flow
npm run sim          # headless balance simulation: a bot plays 10 full runs and reports outcomes
node tools/sim.mjs 12 1 2   # 12 runs, all unlocks, meta upgrades at rank 2
npm run icons        # regenerate the PWA icons
```

`tools/sprite-preview.html` renders every sprite on one sheet (serve the repo and open it).

### Project layout

```
index.html, style.css      HTML shell and UI styles (HUD, controls, screens)
src/main.js                App: game loop, hooks into audio/UI/saves, screen flow
src/core/                  rng (seeded), math, noise, input (joystick + buttons + keys)
src/data/                  ALL tuning and content: config (phases, timers), enemies,
                           weapons/affixes/legendaries, relics, upgrades, events, meta, rarities
src/game/                  Simulation (DOM-free, runs headless):
  run.js                   one 10-minute run: owns every system, talks out via hooks
  map.js                   procedural map, tile collision, enemy flow field
  player.js, enemies.js    player actions; enemy AI behaviors with telegraphs
  combat.js                damage, crits, burn/bleed, chain lightning, shadow waves, explosions
  director.js              spawn pacing per phase, camps, merchants, champion, gate closures
  pickups.js, items.js     drops, magnet, item generation
  events.js                chests, shrines, mysterious chests, merchant, ambushes, gates
  upgrades.js, stats.js    level-up choices with synergy weighting; stat aggregation
  score.js                 score and Ember rewards
src/gfx/                   palette, pixel art (as strings), sprite baking, renderer, lighting, bitmap font
src/systems/               audio (SFX + adaptive music), save (local storage + migration)
src/ui/                    HUD, screens/modals, title backdrop
tests/                     node:test suites
tools/                     balance sim, icon generator, sprite preview
```

### Adding content

Most content changes only touch `src/data/`:

- **A new upgrade:** add an entry to `UPGRADES` with `mods` (stat changes per rank) and `tags` (for synergy). For a new mechanic, add a stat to `STAT_DEFAULTS` in `stats.js` and read it in `combat.js` or `player.js`.
- **A new relic:** add an entry to `RELICS`. Use `when: 'final2'` to make it conditional.
- **A new weapon type:** add a base to `WEAPON_BASES` and its in-hand art to `WEAPON_ART` in `sprites.js`.
- **A new enemy:** add a definition to `ENEMIES` and its sprite. Reuse an existing `behavior`, or add an AI function in `enemies.js`.
- **Balance:** use `PHASES`, `enemyScaling` and `EMBER_RULES` in `config.js`, then check the result with `npm run sim`.

## Performance

The world renders at a low internal resolution (~170 px wide) that CSS scales up by an integer factor, so pixels stay crisp and the GPU does little work. The ground is baked once per map, sprites are pre-rendered, and effects are pooled. In headless Chromium with software rendering, a final-minute horde of about 90 enemies costs around 1.5 ms per frame. Setting graphics to **Low** turns off dynamic lighting and halves particles.

## Deploying

- **Web / PWA:** host the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages). On HTTPS it registers a service worker for offline play and can be installed to the home screen.
- **App stores:** wrap it with [Capacitor](https://capacitorjs.com/) (`npx cap init`, set `webDir` to this folder, then `npx cap add ios/android`). No code changes needed.

## Roadmap

These are deliberately postponed until the core loop is proven fun:

- Daily Run with shared seeds and leaderboards. Maps and runs are already fully seeded, so this needs a seed-of-the-day and a backend.
- More biomes (cave, snow, volcanic, dark realm) and enemies (archer, dark mage, brute).
- Bow and staff weapon types (projectile attacks), plus more playable characters.
- More random events and boss arenas.
