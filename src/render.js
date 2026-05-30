// Renders a game state into the DOM. Full re-render each call — the board is
// tiny (<=52 nodes), so this is simple and fast enough (WORKFLOW.md §11).

(function (root) {
  'use strict';

  var SUIT_GLYPH = ['♣', '♦', '♥', '♠']; // ♣ ♦ ♥ ♠
  var RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function makeCardEl(card, pile, col, index) {
    var c = el('div', 'card');
    c.dataset.pile = pile;
    c.dataset.col = col;
    c.dataset.index = index;
    c.dataset.suit = card.s;
    c.dataset.rank = card.r;

    if (!card.up) {
      c.classList.add('face-down');
      return c;
    }
    c.classList.add(card.s === 1 || card.s === 2 ? 'red' : 'black');
    c.draggable = true; // only face-up cards can start a drag
    var label = RANK_LABEL[card.r];
    var glyph = SUIT_GLYPH[card.s];

    var tl = el('div', 'corner tl');
    tl.innerHTML = label + '<span>' + glyph + '</span>';
    var br = el('div', 'corner br');
    br.innerHTML = label + '<span>' + glyph + '</span>';
    var pip = el('div', 'pip');
    pip.textContent = glyph;
    c.appendChild(tl);
    c.appendChild(br);
    c.appendChild(pip);
    return c;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function render(state) {
    var engine = root.engine;

    // Stock
    var stockEl = document.getElementById('stock');
    clear(stockEl);
    stockEl.classList.remove('empty-recycle');
    if (state.stock.length) {
      // single face-down card represents the whole pile
      stockEl.appendChild(makeCardEl({ s: 0, r: 0, up: false }, 'stock', 0, state.stock.length - 1));
    } else if (state.waste.length) {
      stockEl.classList.add('empty-recycle'); // shows ↻ affordance
    }

    // Waste (show top card only)
    var wasteEl = document.getElementById('waste');
    clear(wasteEl);
    var wTop = engine.top(state.waste);
    if (wTop) wasteEl.appendChild(makeCardEl(wTop, 'waste', 0, state.waste.length - 1));

    // Foundations
    var fnodes = document.querySelectorAll('#foundations .foundation');
    for (var s = 0; s < 4; s++) {
      var fn = fnodes[s];
      clear(fn);
      fn.dataset.ghost = SUIT_GLYPH[s];
      var ft = engine.top(state.foundations[s]);
      if (ft) fn.appendChild(makeCardEl(ft, 'foundation', s, state.foundations[s].length - 1));
    }

    // Tableau (fanned)
    var cols = document.querySelectorAll('#tableau .column');
    for (var col = 0; col < 7; col++) {
      var colEl = cols[col];
      clear(colEl);
      var pile = state.tableau[col];
      var offset = 0;
      for (var i = 0; i < pile.length; i++) {
        var cardEl = makeCardEl(pile[i], 'tableau', col, i);
        cardEl.style.top = offset + 'px';
        colEl.appendChild(cardEl);
        offset += pile[i].up ? 30 : 14; // --fan-up / --fan-down
      }
      // keep column tall enough to receive drops on empty space
      colEl.style.minHeight = (offset + 128) + 'px';
    }
  }

  root.render = render;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { render: render }; }
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
