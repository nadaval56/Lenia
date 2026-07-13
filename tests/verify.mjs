// Verification harness: does canonical Orbium survive & swim under the spec's kernel?
// Also calibrates life-indicator thresholds by measuring mass/coverage in known regimes.
import { Lenia, seededRandom } from '../js/lenia.js';

// Canonical Orbium unicaudatus cell pattern (20x20), from Bert Chan's Lenia work.
const ORBIUM = [
  [0,0,0,0,0,0,0.1,0.14,0.1,0,0,0.03,0.03,0,0,0.3,0,0,0,0],
  [0,0,0,0,0,0.08,0.24,0.3,0.3,0.18,0.14,0.15,0.16,0.15,0.09,0.2,0,0,0,0],
  [0,0,0,0,0,0.15,0.34,0.44,0.46,0.38,0.18,0.14,0.11,0.13,0.19,0.18,0.45,0,0,0],
  [0,0,0,0,0.06,0.13,0.39,0.5,0.5,0.37,0.06,0,0,0,0.02,0.16,0.68,0,0,0],
  [0,0,0,0.11,0.17,0.17,0.33,0.4,0.38,0.28,0.14,0,0,0,0,0,0.18,0.42,0,0],
  [0,0,0.09,0.18,0.13,0.06,0.08,0.26,0.32,0.32,0.27,0,0,0,0,0,0,0.82,0,0],
  [0.27,0,0.16,0.12,0,0,0,0.25,0.38,0.44,0.45,0.34,0,0,0,0,0,0.22,0.17,0],
  [0,0.07,0.2,0.02,0,0,0,0.31,0.48,0.57,0.6,0.57,0,0,0,0,0,0,0.49,0],
  [0,0.59,0.19,0,0,0,0,0.2,0.57,0.69,0.76,0.76,0.49,0,0,0,0,0,0.36,0],
  [0,0.58,0.19,0,0,0,0,0,0.67,0.83,0.9,0.92,0.87,0.12,0,0,0,0,0.22,0.07],
  [0,0,0.46,0,0,0,0,0,0.7,0.93,1,1,1,0.61,0,0,0,0,0.18,0.11],
  [0,0,0.82,0,0,0,0,0,0.47,1,1,0.98,1,0.96,0.27,0,0,0,0.19,0.1],
  [0,0,0.46,0,0,0,0,0,0.25,1,1,0.84,0.92,0.97,0.54,0.14,0.04,0.1,0.21,0.05],
  [0,0,0,0.4,0,0,0,0,0.09,0.8,1,0.82,0.8,0.85,0.63,0.31,0.18,0.19,0.2,0.01],
  [0,0,0,0.36,0.1,0,0,0,0.05,0.54,0.86,0.79,0.74,0.72,0.6,0.39,0.28,0.24,0.13,0],
  [0,0,0,0.01,0.3,0.07,0,0,0.08,0.36,0.64,0.7,0.64,0.6,0.51,0.39,0.29,0.19,0.04,0],
  [0,0,0,0,0.1,0.24,0.14,0.1,0.15,0.29,0.45,0.53,0.52,0.46,0.4,0.31,0.21,0.08,0,0],
  [0,0,0,0,0,0.08,0.21,0.21,0.22,0.29,0.36,0.39,0.37,0.33,0.26,0.18,0.09,0,0,0],
  [0,0,0,0,0,0,0.03,0.13,0.19,0.22,0.24,0.24,0.23,0.18,0.13,0.05,0,0,0,0],
  [0,0,0,0,0,0,0,0,0.02,0.06,0.08,0.09,0.07,0.05,0.01,0,0,0,0,0],
];

function seedFromRows(rows) {
  const h = rows.length, w = rows[0].length;
  const cells = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells[y * w + x] = rows[y][x];
  return { w, h, cells };
}

function centroid(sim) {
  const { A, W, H } = sim;
  let m = 0, cx = 0, cy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = A[y * W + x]; m += v; cx += v * x; cy += v * y;
  }
  return m > 0 ? { x: cx / m, y: cy / m, m } : { x: 0, y: 0, m: 0 };
}

function testOrbium(mu, sigma, R, T, steps = 400) {
  const sim = new Lenia(128, 128, { mu, sigma, R, T });
  sim.placeSeed(seedFromRows(ORBIUM));
  const m0 = (() => { let s = 0; for (const v of sim.A) s += v; return s; })();
  const c0 = centroid(sim);
  let minMass = Infinity, maxMass = 0;
  const samples = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    const M = sim.mass * 128 * 128;
    minMass = Math.min(minMass, M); maxMass = Math.max(maxMass, M);
    if (i % 100 === 99) samples.push({ step: i + 1, mass: +M.toFixed(1), cov: +(sim.coverage * 100).toFixed(1) });
  }
  const c1 = centroid(sim);
  const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const alive = minMass > m0 * 0.3 && maxMass < m0 * 3;
  console.log(`Orbium μ=${mu} σ=${sigma} R=${R} T=${T}: m0=${m0.toFixed(1)} min=${minMass.toFixed(1)} max=${maxMass.toFixed(1)} moved=${dist.toFixed(1)}px alive=${alive}`);
  console.log('  samples:', JSON.stringify(samples));
  return { alive, dist, sim };
}

console.log('=== Orbium parameter sweep ===');
for (const sigma of [0.014, 0.015, 0.016, 0.017]) {
  testOrbium(0.15, sigma, 13, 10);
}

console.log('\n=== Regime calibration (soup at various mu/sigma, R=13 T=10, 128x128) ===');
function testSoup(mu, sigma, steps = 300, seed = 42) {
  const sim = new Lenia(128, 128, { mu, sigma, R: 13, T: 10 });
  sim.soup(0.5, 0.6, seededRandom(seed));
  for (let i = 0; i < steps; i++) sim.step();
  console.log(`soup μ=${mu} σ=${sigma}: mass=${sim.mass.toFixed(4)} coverage=${(sim.coverage * 100).toFixed(1)}%`);
  return sim;
}
// expected chaos (sigma large), life-ish (middle), void (sigma tiny)
testSoup(0.15, 0.005);
testSoup(0.15, 0.017);
testSoup(0.15, 0.03);
testSoup(0.15, 0.06);
testSoup(0.15, 0.09);
testSoup(0.25, 0.03);
testSoup(0.30, 0.06);
testSoup(0.12, 0.01);
