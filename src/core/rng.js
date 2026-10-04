// Seeded pseudo-random number generator (mulberry32) plus helpers.
// Every random decision in a run goes through an RNG instance so a run can be
// reproduced from its seed (the foundation for a future Daily Run).

export class RNG {
  constructor(seed = Date.now()) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Pick from `items` using weightFn(item) -> number. Returns null when every weight is 0. */
  weighted(items, weightFn) {
    let total = 0;
    for (const it of items) total += Math.max(0, weightFn(it));
    if (total <= 0) return null;
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, weightFn(it));
      if (roll < 0) return it;
    }
    return items[items.length - 1];
  }

  /** Pick a key from an object of { key: weight }. */
  weightedKey(table) {
    const keys = Object.keys(table);
    return this.weighted(keys, (k) => table[k]);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Derive an independent generator so sub-systems don't disturb each other's sequences. */
  fork() {
    return new RNG(Math.floor(this.next() * 4294967296));
  }
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
