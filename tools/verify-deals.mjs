// CI guard: confirm every bundled deal in src/deals.js is genuinely winnable.
//   node tools/verify-deals.mjs   (or: npm run verify)
//
// This is the cheap, meaningful check for issue #1 — it re-solves the committed
// pool directly (no wasted scanning of discarded deals like a full regen) and
// fails loudly if any deal is not solver-winnable or the file is malformed.

import engine from '../src/engine.js';
import solver from './solver.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MAX_NODES = 150000; // must match tools/generate-deals.mjs

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'deals.js'), 'utf8');

// src/deals.js is a browser file that assigns window.Solitaire.DEALS. Run it
// against a local stand-in `window` (direct eval sees this lexical binding).
const window = {};
eval(src); // eslint-disable-line no-eval
const DEALS = window.Solitaire && window.Solitaire.DEALS;

if (!DEALS) { console.error('src/deals.js did not define window.Solitaire.DEALS'); process.exit(1); }

let total = 0;
let failed = 0;
for (const [bucket, deals] of Object.entries(DEALS)) {
  for (const order of deals) {
    total++;
    if (order.length !== 52) { console.error(`${bucket}: deal has ${order.length} cards`); failed++; continue; }
    const r = solver.solve(order, { maxNodes: MAX_NODES });
    if (!r.solved) { console.error(`${bucket}: UNWINNABLE deal ${JSON.stringify(order)}`); failed++; }
  }
  console.log(`  ${bucket}: ${deals.length} deals checked`);
}

if (failed) { console.error(`FAIL: ${failed}/${total} deals are not winnable.`); process.exit(1); }
console.log(`OK: all ${total} bundled deals are solver-verified winnable.`);
