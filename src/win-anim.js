// Win celebrations (issue #5). One of several canvas animations plays when the
// player wins. Three "standard" reels are picked at random; two more are HIDDEN
// easter eggs, unlocked only by how the game was won:
//   - a sub-SPEED_MS finish   -> the fountain
//   - a <= EFFICIENT_MOVES win -> the golden supernova
// Everything shares one full-screen canvas. Click to skip. Honors
// prefers-reduced-motion (skips straight to the stats overlay).

(function (root) {
  'use strict';

  var SUIT_GLYPH = ['♣', '♦', '♥', '♠']; // ♣ ♦ ♥ ♠
  var RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  var CARD_W = 72, CARD_H = 100;
  var GRAVITY = 0.45, RESTITUTION = 0.82;
  var MAX_MS = 11000; // hard cap so a reel can never run forever

  // Hidden-reel thresholds. Tuned to be earnable but uncommon, so the special
  // finishes stay a surprise. Both are easy to retune.
  var SPEED_MS = 3 * 60 * 1000; // win in under 3:00 -> fountain
  var EFFICIENT_MOVES = 140;    // win in <= 140 moves -> supernova

  var STANDARD = ['cascade', 'fireworks', 'confetti'];

  var canvas = null, ctx = null, raf = null, dpr = 1, W = 0, H = 0;
  var onDoneCb = null, finished = false, startTs = 0, active = null;
  // Shared per-run buffers (reset before each reel inits).
  var cards = [], queue = [], parts = [], lastSpawn = 0, nextBurst = 0;

  function reduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- reel selection (pure — unit-tested in Node) -----------------------
  // Performance unlocks the showier finishes; otherwise pick a standard reel.
  function pickAnimation(opts, rng) {
    opts = opts || {};
    rng = rng || Math.random;
    var lean = opts.moves > 0 && opts.moves <= EFFICIENT_MOVES;
    var fast = opts.elapsedMs > 0 && opts.elapsedMs <= SPEED_MS;
    if (lean) return 'supernova'; // precision reward (rarer, so it wins ties)
    if (fast) return 'fountain';  // speed reward
    return STANDARD[Math.floor(rng() * STANDARD.length)];
  }

  // ---- canvas plumbing ---------------------------------------------------
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

  function clearAll() { ctx.clearRect(0, 0, W, H); }
  // Translucent wash — leaves motion trails and dims the board to a night sky.
  function fade(a) { ctx.fillStyle = 'rgba(6,10,16,' + a + ')'; ctx.fillRect(0, 0, W, H); }

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

  // Draw a card face. Optional c.scale / c.rot / c.alpha / c.glow / c.tint let
  // the fancier reels spin and grow cards; with none set this is the classic
  // upright face used by the cascade.
  function drawCard(c) {
    var sc = c.scale || 1, w = CARD_W * sc, h = CARD_H * sc;
    ctx.save();
    if (c.alpha != null) ctx.globalAlpha = c.alpha;
    if (c.rot) {
      var px = c.x + w / 2, py = c.y + h / 2;
      ctx.translate(px, py); ctx.rotate(c.rot); ctx.translate(-px, -py);
    }
    if (c.glow) { ctx.shadowColor = c.glow; ctx.shadowBlur = 16 * sc; }
    roundRect(c.x, c.y, w, h, 8 * sc);
    ctx.fillStyle = '#f4f1ea'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.fillStyle = (c.s === 1 || c.s === 2) ? '#c5283d' : '#1b1b1b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = 'bold ' + (16 * sc) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(RANK[c.r], c.x + 6 * sc, c.y + 5 * sc);
    ctx.font = (14 * sc) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SUIT_GLYPH[c.s], c.x + 6 * sc, c.y + 22 * sc);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = (40 * sc) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(SUIT_GLYPH[c.s], c.x + w / 2, c.y + h / 2 + 4 * sc);
    if (c.tint) { ctx.fillStyle = c.tint; roundRect(c.x, c.y, w, h, 8 * sc); ctx.fill(); }
    ctx.restore();
  }

  function foundationStarts() {
    var nodes = document.querySelectorAll('#foundations .foundation'), s = [];
    for (var i = 0; i < 4; i++) {
      var r = nodes[i].getBoundingClientRect();
      s[i] = { x: r.left, y: r.top };
    }
    return s;
  }

  // ---- reel: cascade (classic) -------------------------------------------
  // Foundation cards launch one by one, fall under gravity, bounce, and leave
  // trails (the canvas is never cleared) that paint the screen.
  function cascadeInit() {
    var st = foundationStarts();
    for (var rank = 13; rank >= 1; rank--) {
      for (var su = 0; su < 4; su++) queue.push({ s: su, r: rank, start: st[su] });
    }
  }
  function cascadeFrame(ts) {
    if (queue.length && ts - lastSpawn > 70) {
      var q = queue.shift(), dir = Math.random() < 0.5 ? -1 : 1;
      cards.push({ s: q.s, r: q.r, x: q.start.x, y: q.start.y,
        vx: dir * (2 + Math.random() * 5), vy: -(3 + Math.random() * 7) });
      lastSpawn = ts;
    }
    for (var i = cards.length - 1; i >= 0; i--) {
      var c = cards[i];
      c.vy += GRAVITY; c.x += c.vx; c.y += c.vy;
      if (c.y + CARD_H > H) { c.y = H - CARD_H; c.vy = -c.vy * RESTITUTION; }
      drawCard(c);
      if (c.x < -CARD_W * 1.5 || c.x > W + CARD_W * 1.5) cards.splice(i, 1);
    }
    return queue.length === 0 && cards.length === 0;
  }

  // ---- reel: fountain (hidden — fast win) --------------------------------
  // All 52 cards erupt from a nozzle at the bottom centre, spinning, then rain
  // back down past the floor. Cleared each frame for a crisp spray.
  function fountainInit() {
    for (var rank = 13; rank >= 1; rank--) {
      for (var su = 0; su < 4; su++) queue.push({ s: su, r: rank });
    }
  }
  function fountainFrame(ts) {
    clearAll();
    if (queue.length && ts - lastSpawn > 45) {
      queue.shift();
      var spec = fountainDeck.shift() || { s: 0, r: 1 };
      cards.push({ s: spec.s, r: spec.r, x: W / 2 - CARD_W * 0.35, y: H - 24,
        vx: rand(-6, 6), vy: -(13 + Math.random() * 6),
        rot: rand(-0.3, 0.3), vrot: rand(-0.14, 0.14), scale: 0.7 });
      lastSpawn = ts;
    }
    for (var i = cards.length - 1; i >= 0; i--) {
      var c = cards[i];
      c.vy += GRAVITY * 0.92; c.x += c.vx; c.y += c.vy; c.rot += c.vrot;
      drawCard(c);
      if (c.y > H + CARD_H || c.x < -W * 0.3 || c.x > W * 1.3) cards.splice(i, 1);
    }
    return queue.length === 0 && cards.length === 0;
  }
  var fountainDeck = []; // 52-card launch list, pre-built in play()

  // ---- reel: confetti (standard) -----------------------------------------
  // A shower of coloured chips and suit glyphs twirling down from the top.
  var CONFETTI = ['#ffd54a', '#ff5a5f', '#4ad6c0', '#8a7dff', '#7CFC9B', '#ff8fcf'];
  function makeConfetti() {
    return { x: Math.random() * W, y: -20 - Math.random() * H * 0.5,
      vy: 2 + Math.random() * 4, vx: rand(-1, 1), drift: Math.random() * 6.28,
      rot: rand(0, 3.14), vrot: rand(-0.2, 0.2), size: 7 + Math.random() * 8,
      color: CONFETTI[(Math.random() * CONFETTI.length) | 0],
      kind: Math.random() < 0.25 ? 'suit' : 'rect', s: (Math.random() * 4) | 0 };
  }
  function confettiInit() { for (var i = 0; i < 170; i++) parts.push(makeConfetti()); }
  function confettiFrame(ts) {
    clearAll();
    var spawning = ts - startTs < 5200;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.drift += 0.05; p.x += p.vx + Math.sin(p.drift) * 1.2; p.y += p.vy; p.rot += p.vrot;
      ctx.save();
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color;
      if (p.kind === 'rect') ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      else {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = (p.size * 1.7) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillText(SUIT_GLYPH[p.s], 0, 0);
      }
      ctx.restore();
      if (p.y > H + 30) {
        if (spawning) { p.x = Math.random() * W; p.y = -20; }
        else parts.splice(i, 1);
      }
    }
    return !spawning && parts.length === 0;
  }

  // ---- reel: fireworks (standard) ----------------------------------------
  // Radial bursts of coloured sparks against a darkening sky (fade trails).
  function fireworksInit() { nextBurst = 0; }
  function fireworksBurst(x, y) {
    var hue = (Math.random() * 360) | 0, n = 36 + ((Math.random() * 16) | 0);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * 6.2832, sp = 2 + Math.random() * 4.5;
      parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, hue: hue, size: 2 + Math.random() * 2 });
    }
  }
  function fireworksFrame(ts) {
    fade(0.18);
    if (ts - startTs < 5600 && ts > nextBurst) {
      fireworksBurst(rand(W * 0.15, W * 0.85), rand(H * 0.15, H * 0.5));
      nextBurst = ts + 360 + Math.random() * 360;
    }
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += 0.03; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.life -= 0.012;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = 'hsl(' + p.hue + ',100%,' + (55 + p.life * 15) + '%)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    return ts - startTs >= 5600 && parts.length === 0;
  }

  // ---- reel: supernova (hidden — efficient win) --------------------------
  // All 52 cards spiral out of the centre on six arms, growing and glowing
  // gold, shedding sparks — a galaxy blooming outward.
  function supernovaInit() {
    var k = 0;
    for (var rank = 13; rank >= 1; rank--) {
      for (var su = 0; su < 4; su++) {
        cards.push({ s: su, r: rank, a0: (k % 6) * (6.2832 / 6) + Math.random() * 0.3,
          t: -(k * 0.012), x: W / 2, y: H / 2, rot: 0, scale: 0.35,
          glow: 'rgba(255,205,70,0.9)', tint: 'rgba(255,200,70,0.16)' });
        k++;
      }
    }
  }
  function supernovaFrame(ts) {
    fade(0.12);
    var cx = W / 2, cy = H / 2, alive = 0;
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.x += p.vx; p.y += p.vy; p.life -= 0.02;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = p.life; ctx.fillStyle = '#ffd24a';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (var j = 0; j < cards.length; j++) {
      var c = cards[j];
      c.t += 0.016;
      if (c.t < 0) { alive++; continue; } // not yet emerged
      var radius = c.t * c.t * 60;
      var ang = c.a0 + c.t * 1.7;
      c.x = cx + Math.cos(ang) * radius - CARD_W * c.scale / 2;
      c.y = cy + Math.sin(ang) * radius - CARD_H * c.scale / 2;
      c.rot = ang; c.scale = Math.min(0.95, 0.35 + c.t * 0.12);
      if (c.x > -220 && c.x < W + 220 && c.y > -220 && c.y < H + 220) {
        alive++; drawCard(c);
        if (Math.random() < 0.06) {
          parts.push({ x: c.x + CARD_W * c.scale / 2, y: c.y + CARD_H * c.scale / 2,
            vx: rand(-1.5, 1.5), vy: rand(-1.5, 1.5), life: 1, size: 1.5 + Math.random() * 1.5 });
        }
      }
    }
    return ts - startTs > 1200 && alive === 0;
  }

  var ANIMS = {
    cascade: { init: cascadeInit, frame: cascadeFrame },
    fireworks: { init: fireworksInit, frame: fireworksFrame },
    confetti: { init: confettiInit, frame: confettiFrame },
    fountain: { init: fountainInit, frame: fountainFrame },
    supernova: { init: supernovaInit, frame: supernovaFrame }
  };

  // ---- driver ------------------------------------------------------------
  function resetBuffers() {
    cards = []; queue = []; parts = []; fountainDeck = []; lastSpawn = 0; nextBurst = 0;
  }

  function loop(ts) {
    if (!startTs) startTs = ts;
    var done = active.frame(ts);
    if (done || ts - startTs > MAX_MS) { finishNow(); return; }
    raf = requestAnimationFrame(loop);
  }

  // Pick and start a reel. `opts` = { moves, elapsedMs, difficulty } drives the
  // hidden-reel selection. Reveals the overlay (onDone) when the reel ends.
  function play(state, onDone, opts) {
    onDoneCb = onDone; finished = false;
    if (reduced()) { if (onDone) onDone(); return; }
    ensureCanvas();
    resetBuffers();
    var name = pickAnimation(opts, Math.random);
    active = ANIMS[name] || ANIMS.cascade;
    if (name === 'fountain') { // pre-build the 52-card launch list
      for (var rank = 13; rank >= 1; rank--) for (var su = 0; su < 4; su++) fountainDeck.push({ s: su, r: rank });
    }
    active.init();
    startTs = 0;
    raf = requestAnimationFrame(loop);
  }

  // Stop animating and reveal the overlay (on finish or click-to-skip).
  function finishNow() {
    if (finished) return;
    finished = true;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (canvas) canvas.style.pointerEvents = 'none';
    if (onDoneCb) { var cb = onDoneCb; onDoneCb = null; cb(); }
  }

  // Full teardown (on New Game / Restart): clear trails and hide the canvas.
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    finished = true; resetBuffers(); active = null;
    if (canvas) {
      if (ctx) ctx.clearRect(0, 0, W, H);
      canvas.style.display = 'none';
      canvas.style.pointerEvents = 'none';
    }
  }

  var api = {
    play: play, stop: stop, pickAnimation: pickAnimation,
    SPEED_MS: SPEED_MS, EFFICIENT_MOVES: EFFICIENT_MOVES, STANDARD: STANDARD
  };
  root.winAnim = api; // window.Solitaire.winAnim in browser
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; } // Node
})(
  typeof window !== 'undefined'
    ? (window.Solitaire = window.Solitaire || {})
    : (typeof exports !== 'undefined' ? exports : this)
);
