// Mouse interaction layer: click-to-move, drag-and-drop, and double-click
// auto-to-foundation. Talks to the controller only through app.commit / app.getState.

(function (root) {
  'use strict';

  function attach(app) {
    var engine = root.engine;
    var E = engine.MOVES;
    var board = document.getElementById('board');
    var selected = null; // { pile, col, index } click-selection source

    // ---- source / destination resolution --------------------------------
    function sourceFromCard(cardEl) {
      if (!cardEl) return null;
      var pile = cardEl.dataset.pile;
      var col = +cardEl.dataset.col;
      var index = +cardEl.dataset.index;
      var st = app.getState();
      if (pile === 'waste') {
        return index === st.waste.length - 1 ? { pile: 'waste', col: 0, index: index } : null;
      }
      if (pile === 'foundation') {
        var f = st.foundations[col];
        return f.length && index === f.length - 1 ? { pile: 'foundation', col: col, index: index } : null;
      }
      if (pile === 'tableau') {
        var card = st.tableau[col][index];
        if (card && card.up && engine.legalRun(st.tableau[col], index)) {
          return { pile: 'tableau', col: col, index: index };
        }
      }
      return null;
    }

    function destFromPile(pileEl) {
      if (!pileEl) return null;
      var pile = pileEl.dataset.pile;
      if (pile === 'tableau') return { pile: 'tableau', col: +pileEl.dataset.col };
      if (pile === 'foundation') return { pile: 'foundation', col: +pileEl.dataset.col };
      return null; // stock / waste are never drop destinations
    }

    function buildMove(src, dest) {
      if (dest.pile === 'tableau') {
        if (src.pile === 'waste') return { type: E.WASTE_TO_TABLEAU, to: dest.col };
        if (src.pile === 'tableau') return { type: E.TABLEAU_TO_TABLEAU, from: src.col, index: src.index, to: dest.col };
        if (src.pile === 'foundation') return { type: E.FOUNDATION_TO_TABLEAU, from: src.col, to: dest.col };
      } else if (dest.pile === 'foundation') {
        if (src.pile === 'waste') return { type: E.WASTE_TO_FOUNDATION };
        if (src.pile === 'tableau') return { type: E.TABLEAU_TO_FOUNDATION, from: src.col };
      }
      return null;
    }

    // ---- selection highlight --------------------------------------------
    function clearSelection() {
      selected = null;
      var nodes = board.querySelectorAll('.card.selected');
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('selected');
    }
    function highlight(src) {
      var sel;
      if (src.pile === 'tableau') {
        sel = board.querySelectorAll('.column[data-col="' + src.col + '"] .card');
        for (var i = 0; i < sel.length; i++) {
          if (+sel[i].dataset.index >= src.index) sel[i].classList.add('selected');
        }
      } else {
        var q = src.pile === 'waste' ? '.waste .card' : '.foundation[data-col="' + src.col + '"] .card';
        var node = board.querySelector(q);
        if (node) node.classList.add('selected');
      }
    }
    function shake(el) {
      if (!el) return;
      el.classList.remove('shake');
      void el.offsetWidth; // restart animation
      el.classList.add('shake');
      setTimeout(function () { el.classList.remove('shake'); }, 260);
    }

    // ---- click ----------------------------------------------------------
    board.addEventListener('click', function (e) {
      if (app.autoRunning) return;
      var cardEl = e.target.closest('.card');
      var pileEl = e.target.closest('.pile');

      // Stock: draw one, or recycle when empty.
      if (pileEl && pileEl.dataset.pile === 'stock') {
        clearSelection();
        var st = app.getState();
        if (st.stock.length) app.commit({ type: E.DRAW });
        else if (st.waste.length) app.commit({ type: E.RECYCLE });
        return;
      }

      if (!selected) {
        var src = sourceFromCard(cardEl);
        if (src) { selected = src; highlight(src); if (root.sound) root.sound.pick(); }
        return;
      }

      // We have a selection: try to move it onto the clicked destination pile.
      var dest = destFromPile(pileEl);
      if (dest) {
        var move = buildMove(selected, dest);
        if (move && app.commit(move)) { clearSelection(); return; }
        if (move) shake(cardEl || pileEl); // legal-looking target but illegal move
      }
      // Otherwise: switch selection to the newly clicked card, or clear.
      clearSelection();
      var reSrc = sourceFromCard(cardEl);
      if (reSrc) { selected = reSrc; highlight(reSrc); if (root.sound) root.sound.pick(); }
    });

    // ---- double-click: auto to foundation -------------------------------
    board.addEventListener('dblclick', function (e) {
      if (app.autoRunning) return;
      var cardEl = e.target.closest('.card');
      if (!cardEl) return;
      var pile = cardEl.dataset.pile;
      var col = +cardEl.dataset.col;
      var index = +cardEl.dataset.index;
      var st = app.getState();
      var source = null;
      if (pile === 'waste' && index === st.waste.length - 1) source = { pile: 'waste' };
      else if (pile === 'tableau' && index === st.tableau[col].length - 1) source = { pile: 'tableau', col: col };
      if (!source) return;
      var move = engine.availableAutoFoundation(st, source);
      if (move) { clearSelection(); app.commit(move); }
    });

    // ---- drag and drop --------------------------------------------------
    var dragSrc = null;
    board.addEventListener('dragstart', function (e) {
      if (app.autoRunning) { e.preventDefault(); return; }
      var cardEl = e.target.closest('.card');
      var src = sourceFromCard(cardEl);
      if (!src) { e.preventDefault(); return; }
      dragSrc = src;
      clearSelection();
      cardEl.classList.add('dragging');
      if (root.sound) root.sound.pick();
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', 'card'); // Firefox needs data set
      }
    });
    board.addEventListener('dragover', function (e) {
      if (!dragSrc) return;
      var pileEl = e.target.closest('.pile');
      var dest = destFromPile(pileEl);
      if (dest && buildMove(dragSrc, dest)) {
        e.preventDefault(); // allow drop
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        pileEl.classList.add('drop-target');
      }
    });
    board.addEventListener('dragleave', function (e) {
      var pileEl = e.target.closest('.pile');
      if (pileEl) pileEl.classList.remove('drop-target');
    });
    board.addEventListener('drop', function (e) {
      if (!dragSrc) return;
      e.preventDefault();
      var pileEl = e.target.closest('.pile');
      if (pileEl) pileEl.classList.remove('drop-target');
      var dest = destFromPile(pileEl);
      if (dest) {
        var move = buildMove(dragSrc, dest);
        if (move) app.commit(move);
      }
      dragSrc = null;
    });
    board.addEventListener('dragend', function () {
      dragSrc = null;
      var d = board.querySelector('.card.dragging');
      if (d) d.classList.remove('dragging');
      var t = board.querySelectorAll('.pile.drop-target');
      for (var i = 0; i < t.length; i++) t[i].classList.remove('drop-target');
    });
  }

  root.interactions = { attach: attach };
})(window.Solitaire = window.Solitaire || {});
