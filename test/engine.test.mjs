import { test } from 'node:test';
import assert from 'node:assert/strict';
import engine from '../src/engine.js';

const { MOVES } = engine;

// Helper: a fresh empty state we can hand-build for targeted move tests.
function emptyState() {
  return {
    stock: [], waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0, recycles: 0
  };
}
const card = (s, r, up = true) => ({ s, r, up });

test('makeDeck produces 52 unique cards', () => {
  const deck = engine.makeDeck();
  assert.equal(deck.length, 52);
  const codes = new Set(deck.map(engine.cardCode));
  assert.equal(codes.size, 52);
});

test('cardCode / parseCode round-trip', () => {
  for (const c of engine.makeDeck()) {
    const back = engine.parseCode(engine.cardCode(c));
    assert.equal(back.s, c.s);
    assert.equal(back.r, c.r);
  }
  assert.equal(engine.cardCode({ s: 3, r: 13 }), 'KS');
  assert.equal(engine.cardCode({ s: 1, r: 1 }), 'AD');
});

test('dealFromOrder lays out 1..7 columns, one face-up each, 24 in stock', () => {
  const order = engine.shuffledOrder(42);
  const st = engine.dealFromOrder(order);
  for (let col = 0; col < 7; col++) {
    assert.equal(st.tableau[col].length, col + 1, `col ${col} size`);
    const faceUp = st.tableau[col].filter((c) => c.up).length;
    assert.equal(faceUp, 1, `col ${col} has exactly one face-up`);
    assert.ok(st.tableau[col][col].up, `col ${col} top is face-up`);
  }
  assert.equal(st.stock.length, 24);
  assert.equal(st.waste.length, 0);
  assert.ok(st.stock.every((c) => !c.up), 'stock all face-down');
  // all 52 distinct
  const all = [...st.stock, ...st.tableau.flat()];
  assert.equal(new Set(all.map(engine.cardCode)).size, 52);
});

test('shuffledOrder is deterministic per seed', () => {
  assert.deepEqual(engine.shuffledOrder(7), engine.shuffledOrder(7));
  assert.notDeepEqual(engine.shuffledOrder(7), engine.shuffledOrder(8));
});

test('canStackTableau: opposite color, one rank lower; empty needs King', () => {
  assert.ok(engine.canStackTableau(card(3, 12), card(2, 13)));  // black Q on red K
  assert.ok(!engine.canStackTableau(card(0, 12), card(3, 13))); // black Q on black K
  assert.ok(!engine.canStackTableau(card(2, 11), card(2, 13))); // wrong rank
  assert.ok(engine.canStackTableau(card(3, 13), null));         // King on empty
  assert.ok(!engine.canStackTableau(card(3, 12), null));        // non-King on empty
  assert.ok(!engine.canStackTableau(card(2, 12), card(3, 13, false))); // onto face-down
});

test('canMoveToFoundation: Ace on empty then ascending same pile', () => {
  assert.ok(engine.canMoveToFoundation(card(0, 1), []));        // Ace on empty
  assert.ok(!engine.canMoveToFoundation(card(0, 2), []));       // 2 on empty - no
  assert.ok(engine.canMoveToFoundation(card(0, 2), [card(0, 1)])); // 2 on Ace
  assert.ok(!engine.canMoveToFoundation(card(0, 3), [card(0, 1)])); // gap
});

test('legalRun detects valid alternating descending runs', () => {
  const col = [card(3, 13, false), card(2, 7), card(3, 6), card(1, 5)]; // 7r,6b,5r face up
  assert.ok(engine.legalRun(col, 1));   // from the 7
  assert.ok(engine.legalRun(col, 3));   // single top card
  assert.ok(!engine.legalRun(col, 0));  // starts on face-down
  const bad = [card(2, 7), card(2, 6)]; // same color
  assert.ok(!engine.legalRun(bad, 0));
});

test('DRAW moves one card stock->waste face-up; counts a move', () => {
  const st = emptyState();
  st.stock.push(card(0, 5, false), card(1, 9, false));
  const next = engine.applyMove(st, { type: MOVES.DRAW });
  assert.equal(next.stock.length, 1);
  assert.equal(next.waste.length, 1);
  assert.ok(engine.top(next.waste).up);
  assert.equal(engine.cardCode(engine.top(next.waste)), '9D');
  assert.equal(next.moves, 1);
  // original untouched (immutability)
  assert.equal(st.stock.length, 2);
  assert.equal(st.waste.length, 0);
});

test('RECYCLE only when stock empty; refills stock face-down', () => {
  const st = emptyState();
  st.waste.push(card(0, 1), card(1, 2));
  assert.ok(engine.isLegalMove(st, { type: MOVES.RECYCLE }));
  const next = engine.applyMove(st, { type: MOVES.RECYCLE });
  assert.equal(next.stock.length, 2);
  assert.equal(next.waste.length, 0);
  assert.ok(next.stock.every((c) => !c.up));
  assert.equal(next.recycles, 1);
  // not legal if stock non-empty
  st.stock.push(card(2, 3, false));
  assert.ok(!engine.isLegalMove(st, { type: MOVES.RECYCLE }));
});

test('TABLEAU_TO_TABLEAU moves a run and auto-flips the exposed card', () => {
  const st = emptyState();
  st.tableau[0] = [card(3, 13, false), card(2, 7)]; // face-down K, face-up 7h
  st.tableau[1] = [card(3, 8)];                      // 8s (black)
  const move = { type: MOVES.TABLEAU_TO_TABLEAU, from: 0, index: 1, to: 1 };
  assert.ok(engine.isLegalMove(st, move));
  const next = engine.applyMove(st, move);
  assert.equal(next.tableau[1].length, 2);
  assert.equal(next.tableau[0].length, 1);
  assert.ok(next.tableau[0][0].up, 'exposed card auto-flipped');
});

test('TABLEAU_TO_FOUNDATION and auto-flip', () => {
  const st = emptyState();
  st.tableau[0] = [card(0, 5, false), card(2, 1)]; // hidden 5, face-up Ace hearts
  const move = { type: MOVES.TABLEAU_TO_FOUNDATION, from: 0 };
  const next = engine.applyMove(st, move);
  assert.equal(next.foundations[2].length, 1);
  assert.equal(next.tableau[0].length, 1);
  assert.ok(next.tableau[0][0].up);
});

test('illegal move throws', () => {
  const st = emptyState();
  assert.throws(() => engine.applyMove(st, { type: MOVES.DRAW })); // empty stock
});

test('availableAutoFoundation finds a legal foundation target or null', () => {
  const st = emptyState();
  st.waste.push(card(1, 1)); // Ace diamonds
  const m = engine.availableAutoFoundation(st, { pile: 'waste' });
  assert.ok(m && m.type === MOVES.WASTE_TO_FOUNDATION);
  st.waste[0] = card(1, 5); // 5 with empty foundation - no
  assert.equal(engine.availableAutoFoundation(st, { pile: 'waste' }), null);
});

test('isWin only when all four foundations are complete', () => {
  const st = emptyState();
  assert.ok(!engine.isWin(st));
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 13; r++) st.foundations[s].push(card(s, r));
  }
  assert.ok(engine.isWin(st));
});
