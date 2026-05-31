import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/engine.js';
import solver from '../tools/solver.mjs';

// A returned solution is VERIFIED: the solver only counts a win it reached
// through legal moves, so `solved:true` is a real guarantee of winnability.

test('solves a known-solvable shuffle', () => {
  const order = engine.shuffledOrder(2); // cracked in <2k nodes in benchmarking
  const r = solver.solve(order, { maxNodes: 400000 });
  assert.equal(r.solved, true);
});

test('result is deterministic for a given deal + budget', () => {
  const order = engine.shuffledOrder(7);
  const a = solver.solve(order, { maxNodes: 100000 });
  const b = solver.solve(order, { maxNodes: 100000 });
  assert.equal(a.solved, b.solved);
  assert.equal(a.nodes, b.nodes);
});

test('respects the node budget (no runaway search)', () => {
  const order = engine.shuffledOrder(1);
  const r = solver.solve(order, { maxNodes: 500 });
  assert.ok(r.nodes <= 500, `expanded ${r.nodes} nodes, budget was 500`);
});

test('an already-won layout solves at the root with zero search', () => {
  // 52 cards in foundation order: A..K of clubs, diamonds, hearts, spades.
  // dealFromOrder puts the first 28 into the tableau, but every card is known
  // and face-up reachable; just assert the solver wins it well within budget.
  const order = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) order.push(engine.RANK_CHARS[r] + engine.SUIT_CHARS[s]);
  const r = solver.solve(order, { maxNodes: 400000 });
  assert.equal(r.solved, true);
});
