// Top-level controller: owns the live state, the undo history stack, the timer,
// and wires the top-bar buttons. Loaded last.

(function (root) {
  'use strict';

  var engine = root.engine;

  var app = {
    state: null,
    history: [],          // stack of prior states; unlimited undo
    difficulty: 'easy',
    timerId: null,
    startTime: 0,
    running: false,
    autoRunning: false,   // true while Auto-Collect is animating
    autoTimer: null,
    hintsLeft: 0,         // remaining hints this game (issue #2)
    currentOrder: null    // the 52-card order of the deal in play, for Restart (issue #4)
  };

  var HINTS_PER_GAME = 3;

  // ---- deal selection ----------------------------------------------------
  // Use the bundled pre-classified pool when present; otherwise fall back to a
  // random shuffle so the game is playable before deals.js is generated.
  function dealForDifficulty(diff) {
    var pool = root.DEALS && root.DEALS[diff];
    if (pool && pool.length) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return engine.shuffledOrder((Math.random() * 1e9) | 0);
  }

  // ---- stats / timer -----------------------------------------------------
  function fmt(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }
  function updateStats() {
    document.getElementById('moves').textContent = app.state.moves;
  }
  function tick() {
    document.getElementById('time').textContent = fmt(Date.now() - app.startTime);
  }
  function startTimerIfNeeded() {
    if (app.running) return;
    app.running = true;
    app.startTime = Date.now();
    app.timerId = setInterval(tick, 250);
  }
  function stopTimer() {
    if (app.timerId) clearInterval(app.timerId);
    app.timerId = null;
    app.running = false;
  }

  function updateUndoBtn() {
    document.getElementById('undo').disabled = app.history.length === 0 || app.autoRunning;
  }

  // ---- auto-collect ------------------------------------------------------
  // Available once everything is known: stock empty and no face-down tableau
  // cards. From there the endgame is finishable by foundation moves alone.
  function canAutoCollect(st) {
    if (st.stock.length) return false;
    for (var c = 0; c < 7; c++) {
      var col = st.tableau[c];
      for (var i = 0; i < col.length; i++) if (!col[i].up) return false;
    }
    return !engine.isWin(st);
  }

  // The next card to send to a foundation, lowest rank first (numerical order).
  function nextAutoMove(st) {
    var bestRank = 99, move = null;
    for (var c = 0; c < 7; c++) {
      var col = st.tableau[c];
      if (!col.length) continue;
      var t = col[col.length - 1];
      if (t.up && engine.canMoveToFoundation(t, st.foundations[t.s]) && t.r < bestRank) {
        bestRank = t.r; move = { type: engine.MOVES.TABLEAU_TO_FOUNDATION, from: c };
      }
    }
    var w = engine.top(st.waste);
    if (w && engine.canMoveToFoundation(w, st.foundations[w.s]) && w.r < bestRank) {
      move = { type: engine.MOVES.WASTE_TO_FOUNDATION };
    }
    return move;
  }

  function updateAutoBtn() {
    document.getElementById('auto-collect').hidden = app.autoRunning || !canAutoCollect(app.state);
  }

  function startAutoCollect() {
    if (app.autoRunning || !canAutoCollect(app.state)) return;
    app.autoRunning = true;
    document.getElementById('new-game').disabled = true;
    document.getElementById('restart').disabled = true;
    document.getElementById('difficulty').disabled = true;
    clearHint();
    updateUndoBtn();
    updateAutoBtn();
    updateHintBtn();
    // Step one card at a time so the player sees them collected in order.
    app.autoTimer = setInterval(function () {
      var m = nextAutoMove(app.state);
      if (!m) { stopAutoCollect(); return; }
      commit(m); // commit plays the collect sound + re-renders + checks win
      if (engine.isWin(app.state)) stopAutoCollect();
    }, 200);
  }

  function stopAutoCollect() {
    if (app.autoTimer) clearInterval(app.autoTimer);
    app.autoTimer = null;
    app.autoRunning = false;
    document.getElementById('new-game').disabled = false;
    document.getElementById('restart').disabled = false;
    document.getElementById('difficulty').disabled = false;
    updateUndoBtn();
    updateAutoBtn();
    updateHintBtn();
  }

  // ---- hint (issue #2) ---------------------------------------------------
  // A limited number of hints per game. The local solver (src/solver.js) knows
  // the full deal, so it returns the first move of an actual winning line from
  // the CURRENT position — the best move regardless of what the player did. If
  // the position can't be won within the budget (e.g. the player dead-ended),
  // it falls back to "flip the next card from the stock".
  function foundationPileEl(s) { return document.querySelector('#foundations .foundation[data-col="' + s + '"]'); }
  function tableauPileEl(col) { return document.querySelector('#tableau .column[data-col="' + col + '"]'); }

  function clearHint() {
    if (app.hintTimer) { clearTimeout(app.hintTimer); app.hintTimer = null; }
    var nodes = document.querySelectorAll('.hint, .hint-target');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('hint');
      nodes[i].classList.remove('hint-target');
    }
  }

  // Add the highlight classes for a move onto the live DOM (after a render).
  function highlightHintMove(move) {
    var M = engine.MOVES, st = app.state, srcEls = [], target = null, wc, col, idx, cards, j;
    switch (move.type) {
      case M.DRAW:
      case M.RECYCLE:
        srcEls.push(document.getElementById('stock'));
        break;
      case M.WASTE_TO_FOUNDATION:
        wc = document.querySelector('.waste .card'); if (wc) srcEls.push(wc);
        target = foundationPileEl(engine.top(st.waste).s);
        break;
      case M.WASTE_TO_TABLEAU:
        wc = document.querySelector('.waste .card'); if (wc) srcEls.push(wc);
        target = tableauPileEl(move.to);
        break;
      case M.TABLEAU_TO_FOUNDATION:
        col = st.tableau[move.from]; idx = col.length - 1;
        cards = document.querySelectorAll('#tableau .column[data-col="' + move.from + '"] .card');
        for (j = 0; j < cards.length; j++) if (+cards[j].dataset.index === idx) srcEls.push(cards[j]);
        target = foundationPileEl(col[idx].s);
        break;
      case M.TABLEAU_TO_TABLEAU:
        cards = document.querySelectorAll('#tableau .column[data-col="' + move.from + '"] .card');
        for (j = 0; j < cards.length; j++) if (+cards[j].dataset.index >= move.index) srcEls.push(cards[j]);
        target = tableauPileEl(move.to);
        break;
    }
    for (var k = 0; k < srcEls.length; k++) if (srcEls[k]) srcEls[k].classList.add('hint');
    if (target) target.classList.add('hint-target');
    app.hintTimer = setTimeout(clearHint, 2800);
  }

  function updateHintBtn() {
    var btn = document.getElementById('hint');
    if (!btn) return;
    btn.disabled = app.autoRunning || app.hintsLeft <= 0 || !app.state || engine.isWin(app.state);
    btn.textContent = app.hintsLeft > 0 ? 'Hint (' + app.hintsLeft + ')' : 'No Hints';
  }

  function showHint() {
    if (app.autoRunning || app.hintsLeft <= 0 || engine.isWin(app.state)) return;
    var solver = root.solver;
    if (!solver) return;
    var move = solver.hint(app.state);
    if (!move) return; // nothing left to suggest (e.g. stock and waste both empty)
    clearHint();
    highlightHintMove(move);
    if (root.sound) root.sound.pick();
    app.hintsLeft--;
    updateHintBtn();
  }

  // ---- core actions ------------------------------------------------------
  function afterChange() {
    clearHint();
    root.render(app.state);
    updateStats();
    updateUndoBtn();
    updateAutoBtn();
    updateHintBtn();
    if (engine.isWin(app.state)) onWin();
  }

  // Pick the right sound(s) for a committed move, including the secondary
  // "flip" when a tableau move exposes a face-down card.
  function playMoveSounds(prev, move, next) {
    var s = root.sound;
    if (!s) return;
    var M = engine.MOVES;
    if (move.type === M.DRAW) s.flip();
    else if (move.type === M.WASTE_TO_FOUNDATION || move.type === M.TABLEAU_TO_FOUNDATION) s.collect();
    else s.move();

    if (move.type === M.TABLEAU_TO_TABLEAU || move.type === M.TABLEAU_TO_FOUNDATION) {
      var col = next.tableau[move.from];
      if (col.length) {
        var i = col.length - 1;
        var before = prev.tableau[move.from][i];
        if (col[i].up && before && !before.up) setTimeout(function () { s.flip(); }, 90);
      }
    }
  }

  // Attempt a move. Returns true if applied, false if illegal.
  function commit(move) {
    if (!engine.isLegalMove(app.state, move)) return false;
    var prev = app.state;
    app.history.push(prev);               // states are immutable, safe to keep
    app.state = engine.applyMove(prev, move);
    playMoveSounds(prev, move, app.state);
    startTimerIfNeeded();
    afterChange();
    return true;
  }

  function undo() {
    if (!app.history.length) return;
    app.state = app.history.pop();
    afterChange();
  }

  // Deal `order` to the board and reset everything tied to a single match:
  // undo history, hint budget, timer, and the win overlay. `dealFromOrder`
  // builds a fresh state out of new card objects without mutating `order`, so
  // the same array can be re-dealt later (that's what Restart relies on).
  function startWithOrder(order) {
    if (app.autoRunning) stopAutoCollect();
    if (root.winAnim) root.winAnim.stop();
    app.currentOrder = order;
    app.state = engine.dealFromOrder(order);
    app.history = [];
    app.hintsLeft = HINTS_PER_GAME;
    stopTimer();
    app.startTime = 0;
    document.getElementById('time').textContent = '0:00';
    document.getElementById('win-overlay').classList.add('hidden');
    document.getElementById('restart').disabled = false;
    afterChange();
  }

  function newGame(diff) {
    app.difficulty = diff || app.difficulty;
    startWithOrder(dealForDifficulty(app.difficulty));
  }

  // Restart (issue #4): replay the SAME deal from scratch. Re-deals the stored
  // order, so the player gets an identical opening to retry after dead-ending.
  function restart() {
    if (!app.currentOrder) return;
    startWithOrder(app.currentOrder);
  }

  function onWin() {
    var elapsedMs = app.startTime ? Date.now() - app.startTime : 0;
    stopTimer();
    if (root.sound) { root.sound.collect(); setTimeout(function () { root.sound.collect(); }, 160); }
    var t = document.getElementById('time').textContent;
    document.getElementById('win-stats').textContent =
      'Solved in ' + app.state.moves + ' moves · ' + t;
    var overlay = document.getElementById('win-overlay');
    overlay.classList.add('hidden');
    var show = function () { overlay.classList.remove('hidden'); };
    // Play a win reel first; reveal the stats overlay after it finishes (or when
    // the player clicks to skip). The reel is chosen from the game's stats —
    // fast/efficient wins unlock hidden ones (issue #5). winAnim handles
    // reduced-motion. Pass moves + elapsed time so it can pick.
    var stats = { moves: app.state.moves, elapsedMs: elapsedMs, difficulty: app.difficulty };
    if (root.winAnim) root.winAnim.play(app.state, show, stats); else show();
  }

  app.getState = function () { return app.state; };
  app.sync = afterChange; // re-render + refresh controls from current state
  app.commit = commit;
  app.undo = undo;
  app.newGame = newGame;
  app.restart = restart;

  // ---- bootstrap ---------------------------------------------------------
  function boot() {
    document.getElementById('new-game').addEventListener('click', function () {
      newGame(document.getElementById('difficulty').value);
    });
    document.getElementById('win-new-game').addEventListener('click', function () {
      newGame(document.getElementById('difficulty').value);
    });
    document.getElementById('restart').addEventListener('click', restart);
    document.getElementById('undo').addEventListener('click', undo);
    document.getElementById('hint').addEventListener('click', showHint);
    document.getElementById('auto-collect').addEventListener('click', startAutoCollect);
    document.getElementById('sound-toggle').addEventListener('click', function (e) {
      if (!root.sound) return;
      var on = !root.sound.isEnabled();
      root.sound.setEnabled(on);
      e.currentTarget.textContent = on ? '🔊' : '🔇';
      if (on) root.sound.pick();
    });
    document.getElementById('difficulty').addEventListener('change', function (e) {
      app.difficulty = e.target.value; // applies on next New Game
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });

    if (root.interactions) root.interactions.attach(app);
    newGame(document.getElementById('difficulty').value);
  }

  root.app = app;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.Solitaire = window.Solitaire || {});
