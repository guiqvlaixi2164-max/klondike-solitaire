import { test } from 'node:test';
import assert from 'node:assert/strict';
import winAnim from '../src/win-anim.js';

// Only the reel-selection logic is pure (the rendering needs a canvas/DOM).
// These tests pin the "hidden easter egg" rules from issue #5.

const { pickAnimation, SPEED_MS, EFFICIENT_MOVES, STANDARD } = winAnim;

test('an efficient (low-move) win unlocks the supernova', () => {
  assert.equal(pickAnimation({ moves: EFFICIENT_MOVES, elapsedMs: 9e5 }), 'supernova');
  assert.equal(pickAnimation({ moves: EFFICIENT_MOVES - 30, elapsedMs: 9e5 }), 'supernova');
});

test('a fast win unlocks the fountain', () => {
  assert.equal(pickAnimation({ moves: 300, elapsedMs: SPEED_MS }), 'fountain');
  assert.equal(pickAnimation({ moves: 300, elapsedMs: SPEED_MS - 60000 }), 'fountain');
});

test('efficiency wins ties with speed (supernova is the rarer reward)', () => {
  assert.equal(pickAnimation({ moves: 100, elapsedMs: 60000 }), 'supernova');
});

test('an ordinary win only ever yields a standard reel', () => {
  const ordinary = { moves: EFFICIENT_MOVES + 1, elapsedMs: SPEED_MS + 1 };
  for (let i = 0; i < 500; i++) {
    assert.ok(STANDARD.includes(pickAnimation(ordinary)), 'expected a standard reel');
  }
});

test('the random draw can reach every standard reel', () => {
  const ordinary = { moves: 9999, elapsedMs: 9e8 };
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(pickAnimation(ordinary));
  for (const name of STANDARD) assert.ok(seen.has(name), `never picked ${name}`);
});

test('a custom rng makes selection deterministic', () => {
  const ordinary = { moves: 9999, elapsedMs: 9e8 };
  const first = () => 0;   // -> STANDARD[0]
  const last = () => 0.999; // -> STANDARD[last]
  assert.equal(pickAnimation(ordinary, first), STANDARD[0]);
  assert.equal(pickAnimation(ordinary, last), STANDARD[STANDARD.length - 1]);
});

test('missing/zero stats fall back to a standard reel (no false unlocks)', () => {
  assert.ok(STANDARD.includes(pickAnimation()));
  assert.ok(STANDARD.includes(pickAnimation({ moves: 0, elapsedMs: 0 })));
});
