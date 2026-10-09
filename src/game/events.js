// Points of interest and random events: chests, mysterious chests, shrines,
// merchants, ambushes and the Rift Gates. Each interaction that needs a
// decision pauses the run and hands the UI a small description to render.

import { SHRINES, MYSTERY_CHEST, MYSTERY_OUTCOMES, MERCHANT, AMBUSH } from '../data/events.js';
import { RARITY_INFO } from '../data/rarities.js';
import { makePotion } from './items.js';

const CHEST_TABLE = {
  common: { gold: [14, 28], items: [{ chance: 0.4, min: 'common' }], potion: 0.2 },
  uncommon: { gold: [30, 55], items: [{ chance: 1, min: 'uncommon' }], potion: 0.15 },
  rare: { gold: [60, 110], items: [{ chance: 1, min: 'rare' }, { chance: 0.45, min: 'uncommon' }], potion: 0.2 },
  epic: { gold: [110, 180], items: [{ chance: 1, min: 'epic' }, { chance: 1, min: 'rare' }], potion: 0.3 },
  legendary: { gold: [180, 260], items: [{ chance: 1, min: 'legendary' }, { chance: 1, min: 'epic' }], potion: 0.4 },
};

export class Events {
  constructor(run) {
    this.run = run;
    this.activeAmbush = null;
  }

  update(dt) {
    const run = this.run;
    const pl = run.player;
    if (pl.dead) return;
    for (const poi of run.pois) {
      const d2 = (poi.x - pl.x) ** 2 + (poi.y - pl.y) ** 2;
      if (!poi.discovered && d2 < 110 * 110) {
        poi.discovered = true;
        if (poi.type === 'landmark') {
          run.hooks.toast(`Discovered: ${poi.name}`, 'gold');
          run.hooks.sfx('discover');
        }
      }
      if (poi.radius <= 0) continue;
      const inside = d2 < (poi.radius + pl.radius) ** 2;
      if (!inside) {
        poi.blocked = false; // left the area: allow re-triggering
        continue;
      }
      if (poi.blocked) continue;
      switch (poi.type) {
        case 'chest':
          if (!poi.opened) this.openChest(poi);
          break;
        case 'mystery':
          if (!poi.used) this.openModal(poi, { kind: 'event', ...MYSTERY_CHEST });
          break;
        case 'shrine':
          if (!poi.used) this.openModal(poi, { kind: 'event', ...SHRINES[poi.kind], choices: this.shrineChoices(poi) });
          break;
        case 'merchant':
          this.openModal(poi, { kind: 'merchant', ...MERCHANT });
          break;
        case 'gate':
          if (poi.open) this.openModal(poi, { kind: 'escape' });
          break;
        case 'ambush':
          if (!poi.triggered) this.triggerAmbush(poi);
          break;
      }
      if (run.modal) break;
    }

    // Merchants leave after a while.
    let gone = false;
    for (const poi of run.pois) {
      if (poi.type === 'merchant' && !poi.gone && run.timeLeft <= poi.expiresAt) {
        poi.gone = gone = true;
        poi.radius = 0;
        run.effects.burst(poi.x, poi.y - 8, ['#6e4a2c', '#ffd36b'], 10, 40, 0.5, 0);
        run.hooks.toast('The merchant has moved on.', 'muted');
      }
    }
    if (gone) run.pois = run.pois.filter((p) => !p.gone);

    // Ambush completion.
    if (this.activeAmbush) {
      const a = this.activeAmbush;
      if (a.enemies.every((e) => e.dead)) {
        run.pickups.dropChest(a.poi.x, a.poi.y, run.phase.itemLevel >= 3 ? 'epic' : AMBUSH.rewardMinRarity, { ambushReward: true });
        run.hooks.banner('AMBUSH SURVIVED', 'A reward chest appears.', 'gold');
        run.hooks.sfx('levelUp');
        this.activeAmbush = null;
      }
    }
  }

  openModal(poi, payload) {
    const run = this.run;
    poi.blocked = true;
    run.openModal({ ...payload, poi });
  }

  shrineChoices(poi) {
    const base = SHRINES[poi.kind].choices;
    return base.map((c) => ({ ...c, disabled: c.needsGold && this.run.gold < 20 }));
  }

  openChest(poi) {
    const run = this.run;
    poi.opened = true;
    const t = CHEST_TABLE[poi.rarity] || CHEST_TABLE.common;
    const levelBonus = poi.treasure || poi.champion ? 1 : 0;
    const goldMult = 1 + (run.phase.itemLevel - 1) * 0.5;
    run.pickups.dropGold(poi.x, poi.y - 4, Math.round(run.rng.int(t.gold[0], t.gold[1]) * goldMult));
    for (const it of t.items) {
      if (!run.rng.chance(it.chance)) continue;
      run.pickups.dropRandomItem(poi.x, poi.y - 4, { minRarity: it.min, levelBonus, bump: poi.cursed ? 1 : 0 });
    }
    if (run.rng.chance(t.potion)) run.pickups.dropPotion(poi.x, poi.y - 4);
    run.stats.chests++;
    run.effects.burst(poi.x, poi.y - 8, ['#ffd36b', '#ff9a3c', RARITY_INFO[poi.rarity].color], 14, 70, 0.6, 40);
    run.hooks.sfx(RARITY_INFO[poi.rarity].tier >= 3 ? 'chestBig' : 'chest');
    run.hooks.shake(RARITY_INFO[poi.rarity].tier >= 3 ? 4 : 1.5);
  }

  triggerAmbush(poi) {
    const run = this.run;
    poi.triggered = true;
    poi.radius = 0;
    const pl = run.player;
    const n = run.rng.int(AMBUSH.waveSize[0], AMBUSH.waveSize[1]) + run.phase.id * 2;
    const enemies = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = run.rng.range(48, 64);
      let x = pl.x + Math.cos(a) * r;
      let y = pl.y + Math.sin(a) * r;
      if (!run.map.isOpenReachable(x, y)) {
        const pt = run.map.findOpenPoint(run.rng, pl.x, pl.y, 40, 80);
        if (!pt) continue;
        x = pt.x;
        y = pt.y;
      }
      const type = run.rng.weightedKey({ skeleton: 4, wolf: 3, slime: 2 });
      const e = run.director.spawnAt(type, x, y, { elite: i === 0, guard: true });
      e.spawnT = 0.6;
      enemies.push(e);
    }
    this.activeAmbush = { poi, enemies };
    run.effects.ring(pl.x, pl.y - 4, 60, '#e0384a', 0.6, 2);
    run.hooks.banner('AMBUSH!', 'Survive to claim the reward.', 'danger');
    run.hooks.sfx('ambush');
    run.hooks.shake(5);
    run.hooks.haptic([30, 40, 30]);
  }

  /** Resolve a modal choice. Returns { title, text, tone } for a result card, or null to just close. */
  resolve(action, payload) {
    const run = this.run;
    const pl = run.player;
    const poi = payload.poi;
    switch (action) {
      case 'leave':
        return null;
      case 'mysteryOpen': {
        poi.used = true;
        poi.radius = 0;
        const outcome = run.rng.weightedKey(MYSTERY_OUTCOMES);
        run.hooks.sfx('chest');
        if (outcome === 'gold') {
          const amount = Math.round(run.rng.int(90, 160) * (1 + (run.phase.itemLevel - 1) * 0.6));
          run.pickups.dropGold(poi.x, poi.y - 4, amount);
          return { title: 'Treasure!', text: `The chest spills ${amount} gold.`, tone: 'gold' };
        }
        if (outcome === 'weapon' || outcome === 'relic') {
          const item = run.pickups.dropRandomItem(poi.x, poi.y - 4, { minRarity: 'rare', forceKind: outcome });
          return { title: 'A gift from the dark', text: `${RARITY_INFO[item.rarity].label}: ${item.name}`, tone: item.rarity };
        }
        if (outcome === 'curse') {
          pl.buffs.push({ id: 'hex', mods: [{ stat: 'moveSpeedPct', value: -0.12 }, { stat: 'armor', value: -4 }] });
          pl.recompute();
          run.pickups.dropGold(poi.x, poi.y - 4, 40);
          return { title: 'Cursed!', text: 'A hex clings to you: -12% move speed, -4 armor for the rest of the run.', tone: 'danger' };
        }
        // Ambush: sprung as soon as the result card is dismissed.
        run.pendingAmbush = poi;
        return { title: 'It was a trap!', text: 'The chest screams. Enemies close in. Survive for a reward.', tone: 'danger' };
      }
      case 'shrineBlood': {
        poi.used = true;
        pl.hp = Math.max(1, pl.hp - Math.round(pl.stats.maxHp * 0.25));
        pl.buffs.push({ id: 'blood', mods: [{ stat: 'damagePct', value: 0.3 }] });
        pl.recompute();
        run.hooks.sfx('shrine');
        run.effects.burst(pl.x, pl.y - 6, ['#e0384a', '#8e1f2c'], 18, 60, 0.6, 40);
        return { title: 'The altar drinks', text: '+30% damage for the rest of the run.', tone: 'danger' };
      }
      case 'shrineGreed': {
        poi.used = true;
        const cost = Math.round(run.gold * 0.4);
        run.gold -= cost;
        const item = run.pickups.dropRandomItem(poi.x, poi.y + 10, { minRarity: 'epic' });
        run.hooks.sfx('shrine');
        return { title: `Offered ${cost} gold`, text: `${RARITY_INFO[item.rarity].label}: ${item.name}`, tone: item.rarity };
      }
      case 'shrineFate': {
        poi.used = true;
        pl.buffs.push({ id: 'fate', mods: [{ stat: 'luck', value: 2 }] });
        run.playerDamageTakenMult *= 1.15;
        pl.recompute();
        run.hooks.sfx('shrine');
        return { title: 'You are marked', text: '+2 luck. Enemies deal +15% damage.', tone: 'purple' };
      }
      case 'shrineHaste': {
        poi.used = true;
        pl.buffs.push({ id: 'haste', mods: [{ stat: 'moveSpeedPct', value: 0.15 }, { stat: 'attackSpeedPct', value: 0.15 }, { stat: 'maxHp', value: -15 }] });
        pl.recompute();
        pl.hp = Math.min(pl.hp, pl.stats.maxHp);
        run.hooks.sfx('shrine');
        return { title: 'The hunt calls', text: '+15% move and attack speed.', tone: 'blue' };
      }
      default:
        return null;
    }
  }

  buy(poi, index) {
    const run = this.run;
    const pl = run.player;
    const s = poi.stock[index];
    if (!s || s.sold || run.gold < s.price) return false;
    if (s.kind === 'potion' && pl.potions >= pl.stats.potionCapacity) return false;
    if (s.kind === 'blessing' && pl.hp >= pl.stats.maxHp) return false;
    run.gold -= s.price;
    run.stats.goldSpent += s.price;
    s.sold = true;
    if (s.kind === 'potion') {
      run.collectItem(makePotion());
      s.sold = false; // potions stay in stock
    } else if (s.kind === 'blessing') {
      pl.heal(pl.stats.maxHp, true);
      run.effects.burst(pl.x, pl.y - 6, ['#7fd65a', '#f4f2ff'], 14, 50, 0.6, -20);
    } else if (s.item) {
      run.collectItem(s.item, { bought: true });
    }
    run.hooks.sfx('buy');
    return true;
  }
}
