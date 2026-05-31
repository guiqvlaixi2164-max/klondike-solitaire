// Casual-player simulator — Node only, generation-time (issue #3).
//
// Models a "reasonable but imperfect" human: it makes sensible moves (reveal
// face-down cards, build sequences, collect to foundations) but with a tunable
// MISTAKE rate it sometimes makes a random/greedy-but-wrong choice. Run many
// seeded trials of one deal and the WIN RATE is our difficulty signal: a
// forgiving deal (many winning lines) is won most of the time -> easy; a fragile
// deal (one narrow line) is lost most of the time -> master. This tracks FELT
// difficulty far better than solver node-count (which is near-constant for the
// ~75% of deals that are trivially forgiving — issue #3).
//
// Deterministic given (order, seed) so the generator's output is reproducible.

import engine from '../src/engine.js';
import solver from '../src/solver.js';

var M = engine.MOVES;

function rngFrom(seed) {
  var a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Candidate non-stock moves, tagged by kind so the policy can prefer good ones.
// kind: 'reveal' (flips a face-down card), 'found' (to foundation), 'build'.
function candidateMoves(st) {
  var out = [];
  var w = engine.top(st.waste);
  if (w && engine.canMoveToFoundation(w, st.foundations[w.s])) {
    out.push({ m: { type: M.WASTE_TO_FOUNDATION }, kind: 'found' });
  }
  for (var c = 0; c < 7; c++) {
    var col = st.tableau[c];
    var t = engine.top(col);
    if (!t) continue;
    if (t.up && engine.canMoveToFoundation(t, st.foundations[t.s])) {
      out.push({ m: { type: M.TABLEAU_TO_FOUNDATION, from: c }, kind: 'found' });
    }
    var firstUp = 0;
    while (firstUp < col.length && !col[firstUp].up) firstUp++;
    for (var i = firstUp; i < col.length; i++) {
      if (!engine.legalRun(col, i)) continue;
      var mover = col[i];
      for (var d = 0; d < 7; d++) {
        if (d === c) continue;
        var dtop = engine.top(st.tableau[d]);
        if (!engine.canStackTableau(mover, dtop)) continue;
        if (mover.r === 13 && i === 0 && !dtop) continue; // pointless King shuffle
        var reveals = (i === firstUp && firstUp > 0);
        out.push({ m: { type: M.TABLEAU_TO_TABLEAU, from: c, index: i, to: d }, kind: reveals ? 'reveal' : 'build' });
      }
    }
  }
  if (w) {
    for (var e = 0; e < 7; e++) {
      if (engine.canStackTableau(w, engine.top(st.tableau[e]))) {
        out.push({ m: { type: M.WASTE_TO_TABLEAU, to: e }, kind: 'build' });
      }
    }
  }
  return out;
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

// One playthrough. Returns true on win, false if stuck or move-capped.
function playTrial(start, rng, p) {
  var st = start;
  var recycles = 0;
  var visited = new Set([solver.hashState(st)]);
  for (var step = 0; step < p.maxSteps; step++) {
    if (engine.isWin(st)) return true;

    var cands = candidateMoves(st);
    // Drop moves that would revisit a state (anti-loop / pointless shuffles).
    var fresh = [];
    for (var i = 0; i < cands.length; i++) {
      if (!visited.has(solver.hashState(engine.applyMove(st, cands[i].m)))) fresh.push(cands[i]);
    }

    var chosen = null;
    if (fresh.length) {
      if (rng() < p.mistake) {
        chosen = pick(fresh, rng).m;                 // mistake: any fresh move
      } else {
        var reveal = fresh.filter(function (x) { return x.kind === 'reveal'; });
        var found = fresh.filter(function (x) { return x.kind === 'found'; });
        var build = fresh.filter(function (x) { return x.kind === 'build'; });
        var bucket = reveal.length ? reveal : (build.length && rng() < p.buildBias ? build : (found.length ? found : build));
        chosen = pick(bucket.length ? bucket : fresh, rng).m;
      }
    }

    if (chosen) {
      st = engine.applyMove(st, chosen);
      visited.add(solver.hashState(st));
    } else if (st.stock.length) {
      st = engine.applyMove(st, { type: M.DRAW });   // dig for something playable
    } else if (st.waste.length && recycles < p.maxRecycles) {
      st = engine.applyMove(st, { type: M.RECYCLE });
      recycles++;
    } else {
      return false; // genuinely stuck
    }
  }
  return false; // gave up (move cap)
}

// Win rate over `trials` seeded playthroughs of one deal (0..1).
function winRate(order, opts) {
  opts = opts || {};
  var p = {
    mistake: opts.mistake != null ? opts.mistake : 0.18,
    buildBias: opts.buildBias != null ? opts.buildBias : 0.6,
    maxRecycles: opts.maxRecycles != null ? opts.maxRecycles : 3,
    maxSteps: opts.maxSteps != null ? opts.maxSteps : 400
  };
  var trials = opts.trials || 60;
  var seed = (opts.seed || 1) >>> 0;
  var rng = rngFrom(seed * 2654435761);
  var wins = 0;
  for (var t = 0; t < trials; t++) {
    if (playTrial(engine.dealFromOrder(order), rng, p)) wins++;
  }
  return wins / trials;
}

export default { winRate: winRate, playTrial: playTrial, candidateMoves: candidateMoves };
