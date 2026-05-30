// Win celebration: the classic bouncing-card cascade. Foundation cards launch
// one by one, fall under gravity, bounce off the bottom in arcs, and leave
// trails that paint the screen (canvas, so trails are cheap). Click to skip.
// Honors prefers-reduced-motion (skips straight to the overlay).

(function (root) {
  'use strict';

  var SUIT_GLYPH = ['♣', '♦', '♥', '♠'];
  var RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var CARD_W = 72, CARD_H = 100;
  var GRAVITY = 0.45, RESTITUTION = 0.82;

  var canvas = null, ctx = null, raf = null, dpr = 1, W = 0, H = 0;
  var cards = [], queue = [], lastSpawn = 0, startTs = 0, onDoneCb = null, finished = false;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'win-canvas';
      document.body.appendChild(canvas);
      canvas.addEventListener('click', finishNow);
    }
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'auto';
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(c) {
    var w = CARD_W, h = CARD_H;
    roundRect(c.x, c.y, w, h, 8);
    ctx.fillStyle = '#f4f1ea'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.fillStyle = (c.s === 1 || c.s === 2) ? '#c5283d' : '#1b1b1b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(RANK[c.r], c.x + 6, c.y + 5);
    ctx.font = '14px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SUIT_GLYPH[c.s], c.x + 6, c.y + 22);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '40px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SUIT_GLYPH[c.s], c.x + w / 2, c.y + h / 2 + 4);
  }

  function spawn(q) {
    var dir = Math.random() < 0.5 ? -1 : 1;
    cards.push({
      s: q.s, r: q.r, x: q.start.x, y: q.start.y,
      vx: dir * (2 + Math.random() * 5),
      vy: -(3 + Math.random() * 7)
    });
  }

  function loop(ts) {
    if (!startTs) startTs = ts;
    if (queue.length && ts - lastSpawn > 70) { spawn(queue.shift()); lastSpawn = ts; }
    for (var i = cards.length - 1; i >= 0; i--) {
      var c = cards[i];
      c.vy += GRAVITY; c.x += c.vx; c.y += c.vy;
      if (c.y + CARD_H > H) { c.y = H - CARD_H; c.vy = -c.vy * RESTITUTION; }
      drawCard(c);
      if (c.x < -CARD_W * 1.5 || c.x > W + CARD_W * 1.5) cards.splice(i, 1);
    }
    if ((queue.length === 0 && cards.length === 0) || ts - startTs > 12000) { finishNow(); return; }
    raf = requestAnimationFrame(loop);
  }

  // Build the launch list (Kings first, cycling suits) from foundation positions.
  function play(state, onDone) {
    onDoneCb = onDone; finished = false;
    if (reduced()) { if (onDone) onDone(); return; }
    ensureCanvas();
    var fnodes = document.querySelectorAll('#foundations .foundation');
    var starts = [];
    for (var s = 0; s < 4; s++) {
      var r = fnodes[s].getBoundingClientRect();
      starts[s] = { x: r.left, y: r.top };
    }
    queue = [];
    for (var rank = 13; rank >= 1; rank--) {
      for (var su = 0; su < 4; su++) queue.push({ s: su, r: rank, start: starts[su] });
    }
    cards = []; lastSpawn = 0; startTs = 0;
    raf = requestAnimationFrame(loop);
  }

  // Stop animating and reveal the overlay (called on finish or on click-to-skip).
  function finishNow() {
    if (finished) return;
    finished = true;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (canvas) canvas.style.pointerEvents = 'none';
    if (onDoneCb) { var cb = onDoneCb; onDoneCb = null; cb(); }
  }

  // Full teardown (on New Game): clear trails and hide the canvas.
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    finished = true; queue = []; cards = [];
    if (canvas) {
      if (ctx) ctx.clearRect(0, 0, W, H);
      canvas.style.display = 'none';
      canvas.style.pointerEvents = 'none';
    }
  }

  root.winAnim = { play: play, stop: stop };
})(window.Solitaire = window.Solitaire || {});
