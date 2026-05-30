// Klondike Solitaire — pure rules engine. No DOM, no globals beyond the export.
//
// Card model: { s, r, up }
//   s = suit  0=Clubs(black) 1=Diamonds(red) 2=Hearts(red) 3=Spades(black)
//   r = rank  1=A, 2..10, 11=J, 12=Q, 13=K
//   up = face-up boolean
//
// State model: see WORKFLOW.md §1.2
//   { stock, waste, foundations[4], tableau[7], moves, recycles }
//   In every pile the TOP card is the LAST element of the array.
//
// Moves are plain objects { type, ... }. All seven types are listed in MOVES.
// applyMove(state, move) returns a NEW deep-cloned state (immutability is what
// makes the UI's unlimited-undo stack trivial and safe).

(function (root) {
  'use strict';

  // ---- constants ---------------------------------------------------------
  var SUIT_CHARS = ['C', 'D', 'H', 'S']; // index = suit
  var RANK_CHARS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];

  var MOVES = {
    DRAW: 'DRAW',                         // stock -> waste (flip one up)
    RECYCLE: 'RECYCLE',                   // waste -> stock (all, face down)
    WASTE_TO_TABLEAU: 'WASTE_TO_TABLEAU', // { to }
    WASTE_TO_FOUNDATION: 'WASTE_TO_FOUNDATION',
    TABLEAU_TO_TABLEAU: 'TABLEAU_TO_TABLEAU',   // { from, index, to }
    TABLEAU_TO_FOUNDATION: 'TABLEAU_TO_FOUNDATION', // { from }
    FOUNDATION_TO_TABLEAU: 'FOUNDATION_TO_TABLEAU'  // { from (suit), to }
  };

  // ---- small helpers -----------------------------------------------------
  function isRed(card) { return card.s === 1 || card.s === 2; }
  function top(pile) { return pile.length ? pile[pile.length - 1] : null; }

  function cardCode(card) { return RANK_CHARS[card.r] + SUIT_CHARS[card.s]; }
  function parseCode(str) {
    return { s: SUIT_CHARS.indexOf(str[1]), r: RANK_CHARS.indexOf(str[0]), up: false };
  }

  function cloneCard(c) { return { s: c.s, r: c.r, up: c.up }; }
  function cloneState(st) {
    return {
      stock: st.stock.map(cloneCard),
      waste: st.waste.map(cloneCard),
      foundations: st.foundations.map(function (f) { return f.map(cloneCard); }),
      tableau: st.tableau.map(function (col) { return col.map(cloneCard); }),
      moves: st.moves,
      recycles: st.recycles
    };
  }

  // ---- deck / deal -------------------------------------------------------
  function makeDeck() {
    var deck = [];
    for (var s = 0; s < 4; s++) {
      for (var r = 1; r <= 13; r++) { deck.push({ s: s, r: r, up: false }); }
    }
    return deck;
  }

  // Reconstruct a full game state from a 52-element order array. Each element is
  // either a card code string ("AS") or a {s,r} object. Deterministic:
  // column i (0..6) receives i+1 cards; the last card of each column is face-up;
  // the remaining 24 cards form the face-down stock. Same mapping is used by the
  // offline generator + heuristic so difficulty labels stay consistent.
  function dealFromOrder(order) {
    var cards = order.map(function (item) {
      if (typeof item === 'string') return parseCode(item);
      return { s: item.s, r: item.r, up: false };
    });
    var st = {
      stock: [], waste: [],
      foundations: [[], [], [], []],
      tableau: [[], [], [], [], [], [], []],
      moves: 0, recycles: 0
    };
    var idx = 0;
    for (var col = 0; col < 7; col++) {
      for (var n = 0; n <= col; n++) {
        var card = cards[idx++];
        card.up = (n === col); // only the last card placed in the column is face-up
        st.tableau[col].push(card);
      }
    }
    while (idx < cards.length) {
      var c = cards[idx++];
      c.up = false;
      st.stock.push(c);
    }
    return st;
  }

  // Deterministic seeded shuffle (mulberry32) — used by the generator, exposed
  // for reproducible tests. Returns a new order array of card codes.
  function shuffledOrder(seed) {
    var deck = makeDeck();
    var a = (seed >>> 0) || 1;
    function rng() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    return deck.map(cardCode);
  }

  // ---- move legality -----------------------------------------------------
  function canStackTableau(moving, onto) {
    if (!onto) return moving.r === 13;           // empty column: King only
    if (!onto.up) return false;                  // can't stack on a face-down card
    return isRed(moving) !== isRed(onto) && moving.r === onto.r - 1;
  }
  function canMoveToFoundation(card, foundationPile) {
    var t = top(foundationPile);
    if (!t) return card.r === 1;                 // empty foundation: Ace only
    return t.r === card.r - 1;                    // same suit guaranteed by index
  }

  // Are cards from `index` to the top of `column` a valid movable run
  // (all face-up, strictly descending, alternating color)?
  function legalRun(column, index) {
    if (index < 0 || index >= column.length) return false;
    if (!column[index].up) return false;
    for (var i = index; i < column.length - 1; i++) {
      var a = column[i], b = column[i + 1];
      if (!b.up) return false;
      if (isRed(a) === isRed(b) || a.r !== b.r + 1) return false;
    }
    return true;
  }

  function isLegalMove(state, move) {
    var f, c;
    switch (move.type) {
      case MOVES.DRAW:
        return state.stock.length > 0;
      case MOVES.RECYCLE:
        return state.stock.length === 0 && state.waste.length > 0;
      case MOVES.WASTE_TO_TABLEAU:
        c = top(state.waste);
        return !!c && canStackTableau(c, top(state.tableau[move.to]));
      case MOVES.WASTE_TO_FOUNDATION:
        c = top(state.waste);
        return !!c && canMoveToFoundation(c, state.foundations[c.s]);
      case MOVES.TABLEAU_TO_TABLEAU:
        if (move.from === move.to) return false;
        if (!legalRun(state.tableau[move.from], move.index)) return false;
        return canStackTableau(state.tableau[move.from][move.index], top(state.tableau[move.to]));
      case MOVES.TABLEAU_TO_FOUNDATION:
        c = top(state.tableau[move.from]);
        return !!c && c.up && canMoveToFoundation(c, state.foundations[c.s]);
      case MOVES.FOUNDATION_TO_TABLEAU:
        f = state.foundations[move.from];
        return f.length > 0 && canStackTableau(top(f), top(state.tableau[move.to]));
      default:
        return false;
    }
  }

  // Flip the new top card of a tableau column face-up if it is face-down.
  function autoFlip(column) {
    var t = top(column);
    if (t && !t.up) t.up = true;
  }

  // Returns a NEW state. Throws if the move is illegal (call isLegalMove first).
  function applyMove(state, move) {
    if (!isLegalMove(state, move)) {
      throw new Error('Illegal move: ' + JSON.stringify(move));
    }
    var st = cloneState(state);
    var c, run;
    switch (move.type) {
      case MOVES.DRAW:
        c = st.stock.pop(); c.up = true; st.waste.push(c);
        break;
      case MOVES.RECYCLE:
        while (st.waste.length) { var w = st.waste.pop(); w.up = false; st.stock.push(w); }
        st.recycles++;
        break;
      case MOVES.WASTE_TO_TABLEAU:
        c = st.waste.pop(); st.tableau[move.to].push(c);
        break;
      case MOVES.WASTE_TO_FOUNDATION:
        c = st.waste.pop(); st.foundations[c.s].push(c);
        break;
      case MOVES.TABLEAU_TO_TABLEAU:
        run = st.tableau[move.from].splice(move.index);
        st.tableau[move.to].push.apply(st.tableau[move.to], run);
        autoFlip(st.tableau[move.from]);
        break;
      case MOVES.TABLEAU_TO_FOUNDATION:
        c = st.tableau[move.from].pop(); st.foundations[c.s].push(c);
        autoFlip(st.tableau[move.from]);
        break;
      case MOVES.FOUNDATION_TO_TABLEAU:
        c = st.foundations[move.from].pop(); st.tableau[move.to].push(c);
        break;
    }
    st.moves++;
    return st;
  }

  function isWin(state) {
    return state.foundations.every(function (f) { return f.length === 13; });
  }

  // For double-click auto-move. source = {pile:'waste'} or {pile:'tableau', col}.
  // Returns a legal foundation move for the top card, or null.
  function availableAutoFoundation(state, source) {
    var move;
    if (source.pile === 'waste') {
      move = { type: MOVES.WASTE_TO_FOUNDATION };
    } else if (source.pile === 'tableau') {
      move = { type: MOVES.TABLEAU_TO_FOUNDATION, from: source.col };
    } else {
      return null;
    }
    return isLegalMove(state, move) ? move : null;
  }

  // ---- export ------------------------------------------------------------
  var api = {
    SUIT_CHARS: SUIT_CHARS, RANK_CHARS: RANK_CHARS, MOVES: MOVES,
    isRed: isRed, top: top, cardCode: cardCode, parseCode: parseCode,
    cloneState: cloneState, makeDeck: makeDeck, dealFromOrder: dealFromOrder,
    shuffledOrder: shuffledOrder, canStackTableau: canStackTableau,
    canMoveToFoundation: canMoveToFoundation, legalRun: legalRun,
    isLegalMove: isLegalMove, applyMove: applyMove, isWin: isWin,
    availableAutoFoundation: availableAutoFoundation
  };

  root.engine = api;       // window.Solitaire.engine in browser
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } // Node
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
