import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/engine.js';
import casual from '../tools/casual-player.mjs';

// The casual player is the difficulty signal (issue #3): win rate over many
// seeded, imperfect playthroughs. Must be in [0,1], reproducible, and it must
// actually SEPARATE deals (the whole point — a flat metric is useless).

test('winRate is in [0,1] and deterministic for a given deal + seed', () => {
  const order = engine.shuffledOrder(2);
  const a = casual.winRate(order, { trials: 30, seed: 7 });
  const b = casual.winRate(order, { trials: 30, seed: 7 });
  assert.equal(a, b);
  assert.ok(a >= 0 && a <= 1, `win rate ${a} out of range`);
});

test('win rate separates a forgiving deal from a fragile one', () => {
  const forgiving = casual.winRate(engine.shuffledOrder(4), { trials: 40, seed: 4 });  // measured ~1.0
  const fragile = casual.winRate(engine.shuffledOrder(2), { trials: 40, seed: 2 });    // measured ~0.0
  assert.ok(forgiving >= 0.8, `expected a forgiving deal to win often, got ${forgiving}`);
  assert.ok(forgiving > fragile, `expected ${forgiving} > ${fragile}`);
});

test('candidateMoves only returns legal moves for the state', () => {
  const state = engine.dealFromOrder(engine.shuffledOrder(5));
  const cands = casual.candidateMoves(state);
  for (const c of cands) assert.ok(engine.isLegalMove(state, c.m), `illegal candidate ${JSON.stringify(c.m)}`);
});
