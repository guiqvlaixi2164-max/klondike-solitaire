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
    running: false
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
    document.getElementById('undo').disabled = app.history.length === 0;
  }

  // ---- core actions ------------------------------------------------------
  function afterChange() {
    root.render(app.state);
    updateStats();
    updateUndoBtn();
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
    document.getElementById('win-overlay').classList.remove('hidden');
  }

  app.getState = function () { return app.state; };
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
