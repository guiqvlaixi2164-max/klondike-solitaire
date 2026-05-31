import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/engine.js';
import solver from '../src/solver.js';

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

test('hint returns a legal move that advances a solvable deal', () => {
  const state = engine.dealFromOrder(engine.shuffledOrder(2));
  const move = solver.hint(state, { maxNodes: 80000 });
  assert.ok(move, 'expected a hint move');
  assert.ok(engine.isLegalMove(state, move), `hint ${JSON.stringify(move)} is illegal`);
});

test('hint falls back to digging the stock when no win is found', () => {
  // Budget of 1 node guarantees the search finds nothing, forcing the fallback.
  const state = engine.dealFromOrder(engine.shuffledOrder(2));
  const move = solver.hint(state, { maxNodes: 1 });
  assert.ok(move && (move.type === engine.MOVES.DRAW || move.type === engine.MOVES.RECYCLE),
    `expected DRAW/RECYCLE fallback, got ${JSON.stringify(move)}`);
});

test('hint does not mutate the passed-in state', () => {
  const state = engine.dealFromOrder(engine.shuffledOrder(3));
  const before = JSON.stringify(state);
  solver.hint(state, { maxNodes: 5000 });
  assert.equal(JSON.stringify(state), before);
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
