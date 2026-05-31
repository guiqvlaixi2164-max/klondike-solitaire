// Klondike solver. Runs in BOTH Node (offline deal generation/verification) and
// the browser (live Hint button — issue #2). Same code, one source of truth.
//
// Approach: depth-first search over game states with a transposition (visited)
// set and a node budget. Move ordering favours progress (revealing face-down
// cards, advancing foundations) so winnable positions are found fast. The search
// is SOUND: a reported win is real (every step goes through engine.applyMove).
// A position the solver cannot crack within the node budget yields no solution —
// offline that means the deal is discarded; for a live hint it means we fall
// back to digging the stock (issue #2).
//
// The search deliberately omits FOUNDATION_TO_TABLEAU moves: pulling a card back
// down off a foundation is virtually never required to win draw-one Klondike and
// it both explodes the branching factor and invites cycles. Excluding it can
// only cause false negatives (a missed win), never a false "solved".

(function (root) {
  'use strict';

  var engine = root.engine ||
    (typeof require !== 'undefined' ? require('./engine.js') : null);
  var MOVES = engine.MOVES;

  // ---- state hashing -------------------------------------------------------
  // Compact, collision-free key for the transposition set: every card identity
  // + face-up flag, foundation heights, and the full stock/waste order (draw
  // position matters with draw-one).
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
  // host a lower opposite-color card in the tableau: both opposite-colour
  // foundations are already at rank-1 or higher (Aces and 2s are always safe).
  // Auto-playing only safe cards never turns a winnable position unwinnable — it
  // is the standard Klondike autoplay rule — so we FORCE such moves (collapsing
  // the search tree) without losing soundness.
  function isRed(card) { return card.s === 1 || card.s === 2; }
  function isSafeToFoundation(st, card) {
    if (card.r <= 2) return true;
    var oppA, oppB;
    if (isRed(card)) { oppA = st.foundations[0].length; oppB = st.foundations[3].length; } // blacks: clubs, spades
    else { oppA = st.foundations[1].length; oppB = st.foundations[2].length; }              // reds: diamonds, hearts
    return oppA >= card.r - 1 && oppB >= card.r - 1;
  }

  // ---- move generation -----------------------------------------------------
  // Returns legal moves for `st`, ordered best-first. If a SAFE foundation move
  // exists, returns just that one (forced autoplay).
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

  // ---- search --------------------------------------------------------------
  // Returns { solved, nodes, move }. `move` is the first move of a winning line
  // (the basis for a hint); `nodes` is the search effort (difficulty signal).
  function search(start, opts) {
    opts = opts || {};
    var maxNodes = opts.maxNodes || 400000;
    var visited = new Set();
    var nodes = 0;

    // True once a win is found anywhere in this subtree.
    function dfs(st) {
      if (engine.isWin(st)) return true;
      if (nodes >= maxNodes) return false;
      var key = hashState(st);
      if (visited.has(key)) return false;
      visited.add(key);
      nodes++;
      var moves = genMoves(st);
      for (var i = 0; i < moves.length; i++) {
        if (dfs(engine.applyMove(st, moves[i]))) return true;
        if (nodes >= maxNodes) return false;
      }
      return false;
    }

    if (engine.isWin(start)) return { solved: true, nodes: 0, move: null };
    // Expand the root explicitly so we can report WHICH first move wins.
    visited.add(hashState(start));
    nodes++;
    var rootMoves = genMoves(start);
    for (var i = 0; i < rootMoves.length; i++) {
      if (dfs(engine.applyMove(start, rootMoves[i]))) {
        return { solved: true, nodes: nodes, move: rootMoves[i] };
      }
      if (nodes >= maxNodes) break;
    }
    return { solved: false, nodes: nodes, move: null };
  }

  // Offline entry: solve a deal given as a 52-card order. { solved, nodes }.
  function solve(order, opts) {
    var r = search(engine.dealFromOrder(order), opts);
    return { solved: r.solved, nodes: r.nodes };
  }

  // Live entry: best next move from an arbitrary game state, or null. Falls back
  // to digging the stock when no win is reachable within the (smaller) budget —
  // e.g. after the player has played into a dead end (issue #2).
  function hint(state, opts) {
    opts = opts || {};
    var budget = opts.maxNodes || 80000;
    if (engine.isWin(state)) return null;
    var r = search(engine.cloneState(state), { maxNodes: budget });
    if (r.solved && r.move) return r.move;
    if (state.stock.length) return { type: MOVES.DRAW };
    if (state.waste.length) return { type: MOVES.RECYCLE };
    return null;
  }

  var api = { solve: solve, hint: hint, search: search, hashState: hashState, genMoves: genMoves };
  root.solver = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
