// Renders a game state into the DOM. Full re-render each call — the board is
// tiny (<=52 nodes), so this is simple and fast enough (WORKFLOW.md §11).

(function (root) {
  'use strict';

  var SUIT_GLYPH = ['♣', '♦', '♥', '♠']; // ♣ ♦ ♥ ♠
  var RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var COURT_GLYPH = { 11: '♞', 12: '♛', 13: '♚' }; // J = knight, Q = queen, K = king

  // Standard pip positions per rank. [x, y] in 0..1 within the inset pip field
  // (x: 0=left 0.5=center 1=right, y: 0=top 1=bottom). Pips with y>0.5 render
  // rotated 180°, exactly like a real deck. Ace is one large central pip.
  var PIP_LAYOUT = {
    1:  [[0.5, 0.5]],
    2:  [[0.5, 0], [0.5, 1]],
    3:  [[0.5, 0], [0.5, 0.5], [0.5, 1]],
    4:  [[0, 0], [1, 0], [0, 1], [1, 1]],
    5:  [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
    6:  [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
    7:  [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
    8:  [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
    9:  [[0, 0], [1, 0], [0, 0.333], [1, 0.333], [0.5, 0.5], [0, 0.667], [1, 0.667], [0, 1], [1, 1]],
    10: [[0, 0], [1, 0], [0.5, 0.1667], [0, 0.333], [1, 0.333], [0, 0.667], [1, 0.667], [0.5, 0.8333], [0, 1], [1, 1]]
  };

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

    var corners = '<span class="glyph">' + glyph + '</span>';
    var tl = el('div', 'corner tl');
    tl.innerHTML = label + corners;
    var br = el('div', 'corner br');
    br.innerHTML = label + corners;
    c.appendChild(tl);
    c.appendChild(br);

    if (card.r >= 11) {
      var court = el('div', 'court');
      court.textContent = COURT_GLYPH[card.r];
      c.appendChild(court);
    } else {
      var layout = PIP_LAYOUT[card.r];
      var pips = el('div', 'pips');
      for (var i = 0; i < layout.length; i++) {
        var pos = layout[i];
        var cls = 'pip' + (card.r === 1 ? ' ace' : '') + (pos[1] > 0.5 ? ' flip' : '');
        var pip = el('div', cls);
        pip.style.left = (pos[0] * 100) + '%';
        pip.style.top = (pos[1] * 100) + '%';
        pip.textContent = glyph;
        pips.appendChild(pip);
      }
      c.appendChild(pips);
    }
    return c;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function build(state) {
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
      colEl.style.minHeight = (offset + 140) + 'px';
    }
  }

  // ---- animation (FLIP: First-Last-Invert-Play) --------------------------
  // We keep the simple full re-render, then make cards glide from their previous
  // screen position to the new one, flip when revealed, and glow when collected.
  var ANIM_MS = 160;          // snappy
  var skipSlide = false;      // set by interactions for drag-commits (no slide)

  function animOn() {
    return typeof window !== 'undefined' && window.matchMedia &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function cardId(node) { return node.dataset.suit + '-' + node.dataset.rank; }

  function snapshot() {
    var map = {}, nodes = document.querySelectorAll('#board .card');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      map[cardId(n)] = {
        rect: n.getBoundingClientRect(),
        up: !n.classList.contains('face-down'),
        pile: n.dataset.pile
      };
    }
    return map;
  }
  function once(node, cls, ms) {
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, ms);
  }
  function slide(node, dx, dy) {
    node.style.transition = 'none';
    node.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    requestAnimationFrame(function () {
      node.style.transition = 'transform ' + ANIM_MS + 'ms ease-out';
      node.style.transform = '';
    });
  }
  function replay(prev, doSlide) {
    var nodes = document.querySelectorAll('#board .card');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var old = prev[cardId(node)];
      var nowUp = !node.classList.contains('face-down');
      var nowPile = node.dataset.pile;
      if (old) {
        var now = node.getBoundingClientRect();
        var dx = old.rect.left - now.left, dy = old.rect.top - now.top;
        if (doSlide && (dx || dy)) slide(node, dx, dy);
        if (!old.up && nowUp) once(node, 'flip-in', ANIM_MS + 40);            // tableau reveal
        if (old.pile !== 'foundation' && nowPile === 'foundation') once(node, 'landed', 240);
      } else if (nowUp && nowPile === 'waste') {
        once(node, 'flip-in', ANIM_MS + 40);                                  // freshly drawn card
      }
    }
  }

  function render(state) {
    var animate = animOn();
    var prev = animate ? snapshot() : null;
    var doSlide = !skipSlide;
    skipSlide = false;
    build(state);
    if (animate) replay(prev, doSlide);
  }
  render.skipSlideOnce = function () { skipSlide = true; };

  root.render = render;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { render: render }; }
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
