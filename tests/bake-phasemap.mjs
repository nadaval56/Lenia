// Bake the initial phase map using the EXACT config from js/phasemap.js
import { Lenia, classifyState, seededRandom } from '../js/lenia.js';

const CONFIG = {
  cols: 15, rows: 11,
  muMin: 0.10, muMax: 0.35,
  sigMin: 0.005, sigMax: 0.10,
  gridSize: 48, R: 8, T: 10,
  steps: 150,
  soupDensity: 0.5, soupFraction: 0.6, soupSeed: 7,
};

function cellParams(index) {
  const { cols, rows, muMin, muMax, sigMin, sigMax } = CONFIG;
  const cx = index % cols, cy = Math.floor(index / cols);
  return {
    mu: muMin + ((cx + 0.5) / cols) * (muMax - muMin),
    sigma: sigMin + ((cy + 0.5) / rows) * (sigMax - sigMin),
  };
}

const t0 = Date.now();
let out = '';
for (let i = 0; i < CONFIG.cols * CONFIG.rows; i++) {
  const { mu, sigma } = cellParams(i);
  const sim = new Lenia(CONFIG.gridSize, CONFIG.gridSize, { mu, sigma, R: CONFIG.R, T: CONFIG.T });
  sim.soup(CONFIG.soupDensity, CONFIG.soupFraction, seededRandom(CONFIG.soupSeed));
  for (let s = 0; s < CONFIG.steps; s++) sim.step();
  out += classifyState(sim.mass, sim.coverage)[0];
}
console.log(`baked in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(out);
// pretty print for eyeballing (sigma high at top)
for (let cy = CONFIG.rows - 1; cy >= 0; cy--) {
  console.log(out.slice(cy * CONFIG.cols, (cy + 1) * CONFIG.cols));
}
