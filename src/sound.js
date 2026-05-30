// Synthesized sound effects via the Web Audio API. No asset files — every
// sound is generated in code, so it works offline over file:// and stays
// reproducible. Sounds: pick (lift), move (place), flip (card flick), collect
// (to foundation). All are short and guarded so a missing/blocked AudioContext
// never throws.

(function (root) {
  'use strict';

  var ctx = null;
  var enabled = true;

  function ac() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // A short tone with an exponential decay envelope.
  function tone(opts) {
    var c = ac();
    if (!c) return;
    var t0 = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.toFreq) osc.frequency.exponentialRampToValueAtTime(opts.toFreq, t0 + opts.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(opts.peak || 0.2, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  // A filtered noise burst — used for the papery card-flick "flip".
  function noise(opts) {
    var c = ac();
    if (!c) return;
    var t0 = c.currentTime;
    var len = Math.floor(c.sampleRate * opts.dur);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = opts.freq || 2200;
    bp.Q.value = opts.q || 0.8;
    var gain = c.createGain();
    gain.gain.value = opts.peak || 0.25;
    src.connect(bp).connect(gain).connect(c.destination);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.02);
  }

  var api = {
    setEnabled: function (v) { enabled = !!v; if (enabled) ac(); },
    isEnabled: function () { return enabled; },
    // call once from a user gesture to unlock audio on strict browsers
    unlock: function () { ac(); },

    flip: function () { if (enabled) noise({ dur: 0.07, freq: 2400, q: 0.7, peak: 0.22 }); },
    pick: function () { if (enabled) tone({ type: 'triangle', freq: 520, dur: 0.06, peak: 0.12 }); },
    move: function () { if (enabled) tone({ type: 'sine', freq: 300, toFreq: 180, dur: 0.11, peak: 0.18 }); },
    collect: function () {
      if (!enabled) return;
      tone({ type: 'sine', freq: 660, dur: 0.12, peak: 0.16 });
      tone({ type: 'sine', freq: 990, dur: 0.16, peak: 0.14, delay: 0.07 });
    }
  };

  root.sound = api;
})(window.Solitaire = window.Solitaire || {});
