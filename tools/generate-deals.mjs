// Offline deal-pool generator. Runs in Node only (never loaded by the browser).
//   node tools/generate-deals.mjs   (or: npm run gen)
//
// Issue #1: every bundled deal is VERIFIED WINNABLE by the offline solver
// (src/solver.js) before it is written. We scan deterministic seeded shuffles,
// run the solver on each, and keep only deals it can actually win.
//
// Issue #3: difficulty is the CASUAL-PLAYER WIN RATE (tools/casual-player.mjs) —
// how often an imperfect player wins the deal over many seeded trials. This
// tracks felt difficulty far better than solver node-count (near-constant for
// the ~75% of deals that are trivially forgiving).
//
// Issue #3 (follow-up): the original build split a small pool into four equal
// quartiles. That made expert/master too soft for two reasons: (1) it stopped at
// the first 400 winnable deals, so "master" was only the unluckiest 25% of a
// mostly-easy sample, not genuinely rare hard deals; and (2) the casual player
// SATURATES — a clumsy bot loses ~100% of hard deals, so a wide band of very
// different deals all collapse to a 0% win rate and become indistinguishable.
//
// Fix: two-tier grading against ABSOLUTE thresholds, with rejection sampling.
//   * The CASUAL player (high mistake rate) measures felt difficulty for a
//     typical player and splits easy vs hard.
//   * A SKILLED player (low mistake rate) only struggles on genuinely fragile
//     deals, so it gives the hard tail the dynamic range the casual player
//     lacks — it splits expert vs master. "Master" = even a strong player
//     almost never wins (brutal, < MASTER_MAX_SKILLED).
// We keep scanning (large MAX_SCAN) until every bucket is full, oversampling the
// rare hard tail instead of stopping at the first N winnable deals.
//
// Output is fully deterministic (seeded RNG, fixed solver + players) so the
// result is reproducible; `npm run verify` re-solves the pool in CI.
//
// Tunables can be overridden via env vars (handy for a fast smoke test), e.g.:
//   PER_BUCKET=10 MAX_SCAN=4000 npm run gen

const num = (name, dflt) => (process.env[name] != null ? Number(process.env[name]) : dflt);

const PER_BUCKET = num('PER_BUCKET', 100);   // deals kept per difficulty
const MAX_NODES = num('MAX_NODES', 150000);  // solver budget per deal (cap-hit = discarded)
const MAX_SCAN = num('MAX_SCAN', 60000);     // safety cap on seeds scanned (hard deals are rare)

const CASUAL_TRIALS = num('CASUAL_TRIALS', 80);    // playthroughs for the casual grade
const CASUAL_MISTAKE = num('CASUAL_MISTAKE', 0.18); // casual = imperfect typical player
const SKILLED_TRIALS = num('SKILLED_TRIALS', 120);  // more trials: we need <5% resolution
const SKILLED_MISTAKE = num('SKILLED_MISTAKE', 0.04); // skilled = near-optimal player

// Absolute difficulty bands (win-rate fractions, 0..1).
//   easy / hard split on the CASUAL player.
//   expert / master split on the SKILLED player.
const EASY_MIN_CASUAL = num('EASY_MIN_CASUAL', 0.80);    // casual wins >= 80%  -> easy
const HARD_MIN_CASUAL = num('HARD_MIN_CASUAL', 0.40);    // casual wins 40-80%  -> hard
const MASTER_MAX_SKILLED = num('MASTER_MAX_SKILLED', 0.05); // skilled wins < 5%   -> master (brutal)
const EXPERT_MAX_SKILLED = num('EXPERT_MAX_SKILLED', 0.30);  // skilled wins 5-30%  -> expert
// A deal the casual player loses (< HARD_MIN) but a skilled player still clears
// reliably (skilled >= EXPERT_MAX) punishes mistakes yet has a clear line -> hard.

const NAMES = ['easy', 'hard', 'expert', 'master'];

import engine from '../src/engine.js';
import solver from '../src/solver.js';
import casual from './casual-player.mjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Grade one winnable deal and decide its bucket. The skilled (more expensive)
// pass only runs for deals the casual player already finds hard, so we don't pay
// for it on the ~75% of deals that are obviously easy.
function classify(order, seed) {
  const casualWR = casual.winRate(order, { trials: CASUAL_TRIALS, mistake: CASUAL_MISTAKE, seed });
  if (casualWR >= EASY_MIN_CASUAL) return { bucket: 'easy', casualWR };
  if (casualWR >= HARD_MIN_CASUAL) return { bucket: 'hard', casualWR };

  const skilledWR = casual.winRate(order, { trials: SKILLED_TRIALS, mistake: SKILLED_MISTAKE, seed });
  if (skilledWR < MASTER_MAX_SKILLED) return { bucket: 'master', casualWR, skilledWR };
  if (skilledWR < EXPERT_MAX_SKILLED) return { bucket: 'expert', casualWR, skilledWR };
  return { bucket: 'hard', casualWR, skilledWR };
}

function collectPool() {
  const buckets = { easy: [], hard: [], expert: [], master: [] };
  const full = () => NAMES.every((n) => buckets[n].length >= PER_BUCKET);
  let seed = 0;
  let solvable = 0;
  while (!full() && seed < MAX_SCAN) {
    seed++;
    const order = engine.shuffledOrder(seed);
    if (!solver.solve(order, { maxNodes: MAX_NODES }).solved) continue; // keep only winnable
    solvable++;
    const graded = classify(order, seed);
    const b = buckets[graded.bucket];
    if (b.length < PER_BUCKET) b.push({ order, ...graded });
    if (seed % 250 === 0) {
      console.log(`  scanned ${seed}: ` + NAMES.map((n) => `${n} ${buckets[n].length}/${PER_BUCKET}`).join(', '));
    }
  }
  if (!full()) {
    const short = NAMES.filter((n) => buckets[n].length < PER_BUCKET)
      .map((n) => `${n} ${buckets[n].length}/${PER_BUCKET}`).join(', ');
    throw new Error(`exhausted ${MAX_SCAN} seeds; under-filled: ${short}. Loosen thresholds or raise MAX_SCAN.`);
  }
  return { buckets, scanned: seed, solvable };
}

// The grading metric that DEFINES each bucket's boundary: casual for easy/hard,
// skilled for expert/master. Used only for the human-readable range comment.
function metric(name, d) {
  return (name === 'expert' || name === 'master') ? d.skilledWR : d.casualWR;
}

function rangesOf(buckets) {
  const ranges = {};
  NAMES.forEach((name) => {
    const vals = buckets[name].map((d) => metric(name, d));
    ranges[name] = [Math.min(...vals), Math.max(...vals)];
  });
  return ranges;
}

function serialize(buckets, scanned, solvable) {
  const ranges = rangesOf(buckets);
  const order = ['easy', 'hard', 'expert', 'master'];
  const pct = (r) => '[' + Math.round(r[0] * 100) + '%,' + Math.round(r[1] * 100) + '%]';
  let s = '';
  s += '// AUTO-GENERATED by tools/generate-deals.mjs — do not edit by hand.\n';
  s += '// Regenerate with: npm run gen\n';
  s += `// Every deal below is SOLVER-VERIFIED WINNABLE (src/solver.js, maxNodes=${MAX_NODES}).\n`;
  s += '// Difficulty = win rate of an imperfect simulated player; higher level = lower win rate.\n';
  s += `//   easy/hard split on a CASUAL player (${CASUAL_TRIALS} trials, mistake=${CASUAL_MISTAKE}).\n`;
  s += `//   expert/master split on a SKILLED player (${SKILLED_TRIALS} trials, mistake=${SKILLED_MISTAKE}).\n`;
  s += `// Win-rate ranges (casual for easy/hard, skilled for expert/master): `;
  s += `${order.map((n) => `${n} ${pct(ranges[n])}`).join(', ')}\n`;
  s += `// Params: perBucket=${PER_BUCKET}, scanned ${scanned} seeds (${solvable} winnable).\n`;
  s += 'window.Solitaire = window.Solitaire || {};\n';
  s += 'window.Solitaire.DEALS = {\n';
  order.forEach((name, ni) => {
    s += `  "${name}": [\n`;
    s += buckets[name].map((d) => '    ' + JSON.stringify(d.order)).join(',\n');
    s += '\n  ]' + (ni < order.length - 1 ? ',' : '') + '\n';
  });
  s += '};\n';
  return { text: s, ranges };
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, '..', 'src', 'deals.js');

console.log(`Scanning seeded shuffles for ${PER_BUCKET} deals per bucket (two-tier casual/skilled grading)...`);
const { buckets, scanned, solvable } = collectPool();
const { text, ranges } = serialize(buckets, scanned, solvable);
writeFileSync(outPath, text);
console.log(`Wrote src/deals.js (${scanned} seeds scanned, ${solvable} winnable graded)`);
console.log('Per-bucket win-rate ranges:');
for (const k of NAMES) {
  const r = ranges[k];
  const who = (k === 'expert' || k === 'master') ? 'skilled' : 'casual';
  console.log(`  ${k}: ${buckets[k].length} deals, ${who} win rate ${(r[0] * 100).toFixed(0)}%–${(r[1] * 100).toFixed(0)}%`);
}
