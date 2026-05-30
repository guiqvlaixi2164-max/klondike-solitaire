import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/engine.js';
import heuristic from '../src/heuristic.js';

// Build a 52-card order placing the four Aces at the given deal positions,
// filling the rest in deck order. (Position->column mapping is in engine.dealFromOrder.)
function withAcesAt(positions) {
  const codes = engine.makeDeck().map(engine.cardCode);
  const aces = codes.filter((c) => c[0] === 'A');
  const rest = codes.filter((c) => c[0] !== 'A');
  const order = new Array(52).fill(undefined);
  positions.forEach((p, i) => { order[p] = aces[i]; });
  let r = 0;
  for (let i = 0; i < 52; i++) if (order[i] === undefined) order[i] = rest[r++];
  return order;
}

test('scoreDeal is deterministic', () => {
  const o = engine.shuffledOrder(123);
  assert.equal(heuristic.scoreDeal(o), heuristic.scoreDeal(o));
});

test('deeply buried Aces score harder than exposed Aces', () => {
  // face-up positions (last card of each column): 0, 2, 5, 9, 14, 20, 27
  const easy = withAcesAt([0, 2, 5, 9]);     // all four Aces face-up at start
  const hard = withAcesAt([21, 22, 23, 24]); // Aces buried deep in column 6
  assert.ok(
    heuristic.scoreDeal(hard) > heuristic.scoreDeal(easy),
    `expected hard(${heuristic.scoreDeal(hard)}) > easy(${heuristic.scoreDeal(easy)})`
  );
});

test('exposed Aces are counted as opening moves', () => {
  const st = engine.dealFromOrder(withAcesAt([0, 2, 5, 9]));
  // at least the face-up Aces can go to a foundation
  assert.ok(heuristic.countInitialMoves(st) >= 4);
});

test('score rises monotonically with Ace burial depth', () => {
  const exposed = heuristic.scoreDeal(withAcesAt([0, 2, 5, 9]));
  const midBuried = heuristic.scoreDeal(withAcesAt([1, 3, 6, 10]));   // one under the top
  const deepBuried = heuristic.scoreDeal(withAcesAt([21, 15, 10, 6]));
  assert.ok(exposed < midBuried, `exposed ${exposed} < mid ${midBuried}`);
  assert.ok(midBuried <= deepBuried, `mid ${midBuried} <= deep ${deepBuried}`);
});
