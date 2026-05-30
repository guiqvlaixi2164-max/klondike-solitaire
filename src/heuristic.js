// Deal difficulty heuristic (no solver — see SCOPE.md §4). scoreDeal(order)
// returns a single number; higher = harder. Used offline by the generator to
// bucket deals into easy/hard/expert/master, and shared with the browser build.
//
// Weights are constants up top so they are easy to tune (SCOPE.md OPEN-C).

(function (root) {
  'use strict';

  // require the engine in Node; reuse the global namespace in the browser.
  var engine = root.engine ||
    (typeof require !== 'undefined' ? require('./engine.js') : null);

  var W = {
    BURIAL: 1,      // per card: cover * (14 - rank)  → low cards buried deep hurt most
    LOWCARD: 6,     // extra per unit of cover for Aces and 2s
    MOVE: 8,        // subtracted per legal opening move (more moves = easier)
    ACE_IN_STOCK: 10, // each Ace stuck in the stock
    CLUSTER: 2      // adjacent same-color cards within a column
  };

  function isRed(card) { return card.s === 1 || card.s === 2; }

  function countInitialMoves(st) {
    var count = 0;
    for (var c = 0; c < 7; c++) {
      var col = st.tableau[c];
      var t = col[col.length - 1];
      if (!t || !t.up) continue;
      if (t.r === 1) count++; // Ace → foundation
      for (var d = 0; d < 7; d++) {
        if (d === c) continue;
        var dc = st.tableau[d];
        var dt = dc[dc.length - 1];
        if (engine.canStackTableau(t, dt || null)) count++;
      }
    }
    return count;
  }

  function scoreDeal(order) {
    var st = engine.dealFromOrder(order);
    var score = 0;

    // Burial: cards covering others, weighted toward low ranks.
    for (var c = 0; c < 7; c++) {
      var col = st.tableau[c];
      for (var i = 0; i < col.length; i++) {
        var card = col[i];
        var cover = col.length - 1 - i; // cards physically on top of this one
        score += cover * (14 - card.r) * W.BURIAL;
        if (card.r <= 2) score += cover * W.LOWCARD;
        if (i < col.length - 1 && isRed(card) === isRed(col[i + 1])) score += W.CLUSTER;
      }
    }

    // Aces trapped in the stock are slow to reach with one-card draw.
    for (var s = 0; s < st.stock.length; s++) {
      if (st.stock[s].r === 1) score += W.ACE_IN_STOCK;
    }

    // Opening mobility makes a deal feel easier.
    score -= countInitialMoves(st) * W.MOVE;

    return score;
  }

  var api = { scoreDeal: scoreDeal, countInitialMoves: countInitialMoves, WEIGHTS: W };
  root.heuristic = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
