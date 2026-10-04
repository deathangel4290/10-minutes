// Seeded 2D value noise with octaves, enough for terrain variation.

export function makeNoise(rng, cells = 16) {
  const n = cells + 1;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const smooth = (t) => t * t * (3 - 2 * t);
  return function sample(u, v) {
    // u, v in [0, 1]
    const x = Math.min(cells - 1e-6, Math.max(0, u * cells));
    const y = Math.min(cells - 1e-6, Math.max(0, v * cells));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = grid[y0 * n + x0];
    const b = grid[y0 * n + x0 + 1];
    const c = grid[(y0 + 1) * n + x0];
    const d = grid[(y0 + 1) * n + x0 + 1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

export function makeFractalNoise(rng, baseCells = 6, octaves = 3) {
  const layers = [];
  for (let i = 0; i < octaves; i++) layers.push(makeNoise(rng, baseCells << i));
  return (u, v) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (const layer of layers) {
      sum += layer(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}
