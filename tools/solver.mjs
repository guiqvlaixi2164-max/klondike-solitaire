// Offline Klondike solver — Node only, never loaded by the browser.
//
// Used by tools/generate-deals.mjs to GUARANTEE that every bundled deal is
// actually winnable (issue #1: unsolvable opening layouts). The game itself
// still runs no solver at play time (SCOPE.md §8); this is generation-time only.
//
// Approach: depth-first search over game states with a transposition (visited)
// set and a node budget. Move ordering favours progress (revealing face-down
// cards, advancing foundations) so winnable deals are found fast. The search is
// SOUND for our purpose: a returned `solved:true` is a real, verified win
// (every step goes through engine.isLegalMove/applyMove). Deals the solver
// cannot crack within the node budget are simply discarded by the generator,
// so we never bundle an unsolvable deal — at worst we drop a few hard-but-
// solvable ones (false negatives are harmless here).
//
// The search deliberately omits FOUNDATION_TO_TABLEAU moves: pulling a card
// back down off a foundation is virtually never required to win draw-one
// Klondike and it both explodes the branching factor and invites cycles.
// Excluding it can only cause false negatives (discarded deals), never a
// falsely-accepted unsolvable one.

import engine from '../src/engine.js';

var MOVES = engine.MOVES;

// ---- state hashing ---------------------------------------------------------
// Compact, collision-free string key for the transposition set. Encodes every
// card identity + face-up flag, foundation heights, and the full stock/waste
// order (draw position matters with draw-one).
function cardChar(card) { return String.fromCharCode(33 + card.s * 13 + (card.r - 1)); }

function hashState(st) {
  var h = '';
  for (var s = 0; s < 4; s++) h += String.fromCharCode(65 + st.foundations[s].length);
  h += '|';
  for (var c = 0; c < 7; c++) {
    var col = st.tableau[c];
    for (var i = 0; i < col.length; i++) h += cardChar(col[i]) + (col[i].up ? '1' : '0');
    h += '/';
  }
  for (var k = 0; k < st.stock.length; k++) h += cardChar(st.stock[k]);
  h += '*';
  for (var w = 0; w < st.waste.length; w++) h += cardChar(st.waste[w]);
  return h;
}

// A card is "safe" to send to its foundation when it can never be needed to
// host a lower opposite-color card in the tableau: i.e. both opposite-colour
// foundations are already at rank-1 or higher (Aces and 2s are always safe).
// Auto-playing only safe cards never turns a winnable deal unwinnable — it is
// the standard Klondike autoplay rule — so we can FORCE such moves (collapsing
// the search tree) without losing soundness.
function isRed(card) { return card.s === 1 || card.s === 2; }
function isSafeToFoundation(st, card) {
  if (card.r <= 2) return true;
  var oppA, oppB;
  if (isRed(card)) { oppA = st.foundations[0].length; oppB = st.foundations[3].length; } // blacks: clubs, spades
  else { oppA = st.foundations[1].length; oppB = st.foundations[2].length; }              // reds: diamonds, hearts
  return oppA >= card.r - 1 && oppB >= card.r - 1;
}

// ---- move generation -------------------------------------------------------
// Returns legal moves for `st`, ordered best-first (higher priority first).
// If a SAFE foundation move exists, returns just that one (forced autoplay).
function genMoves(st) {
  var moves = [];
  var topW = engine.top(st.waste);

  // Forced safe autoplay: waste top.
  if (topW && engine.canMoveToFoundation(topW, st.foundations[topW.s]) && isSafeToFoundation(st, topW)) {
    return [{ type: MOVES.WASTE_TO_FOUNDATION }];
  }
  for (var fc = 0; fc < 7; fc++) {
    var ftop = engine.top(st.tableau[fc]);
    if (ftop && ftop.up && engine.canMoveToFoundation(ftop, st.foundations[ftop.s]) && isSafeToFoundation(st, ftop)) {
      return [{ type: MOVES.TABLEAU_TO_FOUNDATION, from: fc }];
    }
  }

  // waste -> foundation (non-safe: keep as a real choice)
  if (topW && engine.canMoveToFoundation(topW, st.foundations[topW.s])) {
    moves.push({ m: { type: MOVES.WASTE_TO_FOUNDATION }, p: 90 });
  }

  for (var c = 0; c < 7; c++) {
    var col = st.tableau[c];
    var tc = engine.top(col);
    if (!tc) continue;

    // tableau top -> foundation (non-safe)
    if (tc.up && engine.canMoveToFoundation(tc, st.foundations[tc.s])) {
      moves.push({ m: { type: MOVES.TABLEAU_TO_FOUNDATION, from: c }, p: 85 });
    }

    // tableau run -> tableau
    var firstUp = 0;
    while (firstUp < col.length && !col[firstUp].up) firstUp++;
    for (var i = firstUp; i < col.length; i++) {
      if (!engine.legalRun(col, i)) continue;
      var mover = col[i];
      for (var d = 0; d < 7; d++) {
        if (d === c) continue;
        var dcol = st.tableau[d];
        var dtop = engine.top(dcol);
        if (!engine.canStackTableau(mover, dtop)) continue;
        // Prune no-progress King relocation: moving an entire column (which
        // exposes nothing) onto another empty column just shuffles space.
        if (mover.r === 13 && i === 0 && (!dtop)) continue;
        // Reveals a face-down card? (only when moving from the first face-up card)
        var reveals = (i === firstUp && firstUp > 0);
        moves.push({ m: { type: MOVES.TABLEAU_TO_TABLEAU, from: c, index: i, to: d }, p: reveals ? 80 : 40 });
      }
    }
  }

  // waste -> tableau
  if (topW) {
    for (var t = 0; t < 7; t++) {
      if (engine.canStackTableau(topW, engine.top(st.tableau[t]))) {
        moves.push({ m: { type: MOVES.WASTE_TO_TABLEAU, to: t }, p: 50 });
      }
    }
  }

  // draw / recycle (lowest priority — only dig the stock when nothing better)
  if (st.stock.length > 0) {
    moves.push({ m: { type: MOVES.DRAW }, p: 10 });
  } else if (st.waste.length > 0) {
    moves.push({ m: { type: MOVES.RECYCLE }, p: 1 });
  }

  moves.sort(function (a, b) { return b.p - a.p; });
  return moves.map(function (x) { return x.m; });
}

// ---- search ----------------------------------------------------------------
// Returns { solved, nodes }. `nodes` is how many states were expanded — a rough
// search-effort signal the generator can fold into difficulty bucketing.
function solve(order, opts) {
  opts = opts || {};
  var maxNodes = opts.maxNodes || 400000;
  var start = engine.dealFromOrder(order);
  var visited = new Set();
  var nodes = 0;
  var solved = false;

  function dfs(st) {
    if (solved) return;
    if (engine.isWin(st)) { solved = true; return; }
    if (nodes >= maxNodes) return;
    var key = hashState(st);
    if (visited.has(key)) return;
    visited.add(key);
    nodes++;

    var moves = genMoves(st);
    for (var i = 0; i < moves.length; i++) {
      dfs(engine.applyMove(st, moves[i]));
      if (solved || nodes >= maxNodes) return;
    }
  }

  dfs(start);
  return { solved: solved, nodes: nodes };
}

export default { solve: solve, hashState: hashState, genMoves: genMoves };
