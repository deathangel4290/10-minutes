# Last 10 Minutes

**Survive · Loot · Escape · or risk it all.**

A dark-fantasy pixel-art roguelike built for phones, playable upright or sideways. Every run is exactly ten minutes long. You start with a rusty sword, scavenge for better weapons and relics, level up into a build, and decide when to leave through a Rift Gate. Staying longer means better loot and more Embers, until the clock hits 0:00 and the eclipse takes everything you carried.

This is a playable prototype. It focuses on the core "one more run" loop:

- **10-minute runs** with four danger phases. The world gets darker and more crowded as the clock runs down. Passive healing also weakens: it drops by 10%, then 25%, then 40%.
- **Risk/reward extraction.** Three Rift Gates, two of which collapse at 5:00 and 2:00. Escaping later pays more, and reaching 0:00 means you lose your loot.
- **Four regions,** each with its own look, hazards, enemies and rewards. Escaping one unlocks the next:
  - **Forest Ruins** (96×96 tiles): dark pines and ruins.
  - **Frozen Wastes** (108×108): open tundra and frozen lakes. Standing still gives you frostbite, so keep moving or stay near a campfire.
  - **Ashen Caldera** (104×104): lava pools that burn you and enemies alike, and telegraphed eruptions that land where you stand.
  - **Sunken Crypt** (92×92): a rooms-and-corridors dungeon with spike traps and lots of archers.
- **No camping.** Linger in one area for 30 seconds and you become **Hunted**: more enemies arrive, closer to you, and ranged ones come for you. Regen pauses for 2.5s after every hit, lifesteal heals at most about 3% of max HP per second, thorns damage never triggers lifesteal, and armor caps at 60% damage reduction.
- **Combat:** a floating joystick, hold-to-attack with auto-aim, a dash with i-frames, an energy-powered Eclipse Nova, and potions. Hit-stop, screen shake, crits and clear telegraphs: a red wedge before a skeleton swings, a dotted line before a wolf lunges or an archer fires, and a filling circle before a mage's rune or an eruption goes off.
- **Enemies:** skeletons, slimes (they split), wolves, skeleton archers and dark mages. Each region recolors them, and there are elites plus the **Bone Colossus** in the final minutes.
- **Loot and gear:** five rarities. Weapons (swords, plus unlockable daggers and axes) and **armor (helm, chest, boots)** roll random affixes, and there are ten legendary uniques plus 17 relics. Armor you wear shows on your character. The **equipment screen** (bag button, or I) shows your gear on a paper doll, your stats, your relics and your bag, and lets you swap items.
- **Level-ups** pause the game and offer three upgrades. There are 36 upgrades across five build families (crit, fire, bleed, lightning, spectral), and synergy weighting helps builds come together.
- **Random events:** Mysterious Chests (treasure, a curse or an ambush), four kinds of shrine, Wandering Merchants, hidden ambush sites, a guarded treasure room, cursed zones and enemy camps.
- **Emberfall, the town:** you walk around it between runs. Vendors sell permanent upgrades and unlocks for Embers:
  - **Blacksmith:** damage, armor, daggers and axes.
  - **Mystic:** upgrade tomes, XP and rerolls.
  - **Alchemist:** HP, the potion belt and Second Wind.
  - **Trader:** gold, luck and speed.

  The **Rift Portal** picks your region, and the board holds your records.
- **Readability:** a ring and an overhead HP bar on your character, labels on nearby chests, shrines, gates and merchants, status chips (Hunted, Freezing, Burning, healing reduction), and an objective line under the timer. Rapid hits on one enemy merge into a single number.
- **Results screen:** cause of death, everything you lost, a breakdown of Embers earned (with a region bonus), and "NEW REGION UNLOCKED" or "NEW UNLOCK AVAILABLE" prompts. **TRY AGAIN** replays the same region instantly.
- **Saves and settings** live in local storage. The game also autosaves a salvage snapshot, so closing the app mid-run doesn't wipe it.
- **Audio** is fully synthesized with WebAudio. The music adds layers and speeds up with each danger phase.
- **Portrait and landscape:** turn the phone sideways and the game switches layouts. The view widens, the HUD becomes a slim top strip, the controls sit in the bottom corners, and menus split into two columns (level-up choices side by side, vendor wares beside the shopkeeper). You can rotate mid-run. Desktop browsers get the landscape layout too.
- It's an **installable PWA** with offline support.

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
| Bag | I / Tab | Equipment screen |
| II | Esc / P | Pause |

Settings include an **auto-attack (one-handed)** mode.

## Development

```bash
npm test             # unit tests (node:test): RNG, maps, regions, loot, gear, hazards, economy, saves, town, run flow
npm run sim          # headless balance simulation: a bot plays 10 full runs and reports outcomes
node tools/sim.mjs 12 1 2 snow          # 12 Frozen Wastes runs, all unlocks, meta upgrades at rank 2
node tools/sim.mjs 8 1 3 forest turtle  # a bot that stands still with a sustain build (it should die fast)
npm run icons        # regenerate the PWA icons
```

`tools/sprite-preview.html` renders every sprite on one sheet (serve the repo and open it).

### Project layout

```
index.html, style.css      HTML shell and UI styles (HUD, controls, screens)
src/main.js                App: game loop, hooks into audio/UI/saves, screen flow
src/core/                  rng (seeded), math, noise, input (joystick + buttons + keys)
src/data/                  ALL tuning and content: config (phases, timers), biomes (regions), enemies,
                           weapons/affixes/legendaries, armor, relics, upgrades, events, meta, town vendors
src/game/                  Simulation (DOM-free, runs headless):
  run.js                   one 10-minute run: owns every system, talks out via hooks
  map.js                   procedural maps per region (open wilds or rooms), collision, flow field
  hazards.js               Hunted, lava, eruptions, frostbite, spike traps
  town.js                  the walkable town hub (reuses map, player and renderer)
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
- **A new enemy:** add a definition to `ENEMIES` and its sprite. Reuse an existing `behavior` (`melee`, `hopper`, `lunger`, `archer`, `caster`), or add an AI function in `enemies.js`.
- **A new region:** add an entry to `BIOMES`, with its size, layout, terrain thresholds, trees, decor, palette, skin, hazard, difficulty and reward. Then add a palette in `palette.js`, and an enemy skin in `sprites.js` if you want one.
- **A new vendor item:** add it to `META_UPGRADES` or `META_UNLOCKS`, then list it under a vendor in `data/town.js`.
- **Balance:** use `PHASES`, `enemyScaling` and `EMBER_RULES` in `config.js`, then check the result with `npm run sim`.

## Performance

The world renders at a low internal resolution (~170 px wide in portrait, ~200 px tall in landscape) that CSS scales up by an integer factor, so pixels stay crisp and the GPU does little work. The ground is baked once per map, sprites are pre-rendered, and effects are pooled. In headless Chromium with software rendering, a final-minute horde of about 90 enemies costs around 1.5 ms per frame. Setting graphics to **Low** turns off dynamic lighting and halves particles.

## Deploying

- **Web / PWA:** host the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages). On HTTPS it registers a service worker for offline play and can be installed to the home screen.
- **App stores:** wrap it with [Capacitor](https://capacitorjs.com/) (`npx cap init`, set `webDir` to this folder, then `npx cap add ios/android`). No code changes needed.

## Roadmap

These are deliberately postponed until the core loop is proven fun:

- Daily Run with shared seeds and leaderboards. Maps and runs are already fully seeded, so this needs a seed-of-the-day and a backend.
- A Dark Realm region, region-specific bosses, and more enemies (brute, golem, bandit).
- Bow and staff weapon types (projectile attacks), plus more playable characters.
- More town life: a stash for keeping one item between runs, and cosmetic unlocks.
