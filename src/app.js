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
    autoTimer: null
  };

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
    document.getElementById('difficulty').disabled = true;
    updateUndoBtn();
    updateAutoBtn();
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
    document.getElementById('difficulty').disabled = false;
    updateUndoBtn();
    updateAutoBtn();
  }

  // ---- core actions ------------------------------------------------------
  function afterChange() {
    root.render(app.state);
    updateStats();
    updateUndoBtn();
    updateAutoBtn();
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

  function newGame(diff) {
    if (app.autoRunning) stopAutoCollect();
    if (root.winAnim) root.winAnim.stop();
    app.difficulty = diff || app.difficulty;
    var order = dealForDifficulty(app.difficulty);
    app.state = engine.dealFromOrder(order);
    app.history = [];
    stopTimer();
    app.startTime = 0;
    document.getElementById('time').textContent = '0:00';
    document.getElementById('win-overlay').classList.add('hidden');
    afterChange();
  }

  function onWin() {
    stopTimer();
    if (root.sound) { root.sound.collect(); setTimeout(function () { root.sound.collect(); }, 160); }
    var t = document.getElementById('time').textContent;
    document.getElementById('win-stats').textContent =
      'Solved in ' + app.state.moves + ' moves · ' + t;
    var overlay = document.getElementById('win-overlay');
    overlay.classList.add('hidden');
    var show = function () { overlay.classList.remove('hidden'); };
    // Play the bouncing-card cascade first; reveal the stats overlay after it
    // finishes (or when the player clicks to skip). winAnim handles reduced-motion.
    if (root.winAnim) root.winAnim.play(app.state, show); else show();
  }

  app.getState = function () { return app.state; };
  app.sync = afterChange; // re-render + refresh controls from current state
  app.commit = commit;
  app.undo = undo;
  app.newGame = newGame;

  // ---- bootstrap ---------------------------------------------------------
  function boot() {
    document.getElementById('new-game').addEventListener('click', function () {
      newGame(document.getElementById('difficulty').value);
    });
    document.getElementById('win-new-game').addEventListener('click', function () {
      newGame(document.getElementById('difficulty').value);
    });
    document.getElementById('undo').addEventListener('click', undo);
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
