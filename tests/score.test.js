'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { score, THRESHOLDS, STATUSES } = require('../src/score');

const mk = (n, pairs) => ({
  pins: Array.from({ length: n }, (_, i) => ({ id: 'p' + i })),
  strings: pairs.map(([a, b]) => ({ a: 'p' + a, b: 'p' + b })),
});

test('constants', () => {
  assert.deepEqual(THRESHOLDS, [0, 20, 60, 120, 200]);
  assert.deepEqual(STATUSES, ['Hunch', 'Theory', 'Pattern', 'Cover-up', "They don't want you to know"]);
});

test('unconnected pins score 0; empty wall', () => {
  assert.deepEqual(score(mk(0, [])), { score: 0, level: 0, status: 'Hunch' });
  assert.deepEqual(score(mk(5, [])), { score: 0, level: 0, status: 'Hunch' });
});

test('formula: 1 string = 14, 2 chained = 10*2+2*3+5 = 31, star of 3', () => {
  assert.equal(score(mk(2, [[0, 1]])).score, 14);
  assert.equal(score(mk(3, [[0, 1], [1, 2]])).score, 31);
  assert.equal(score(mk(4, [[0, 1], [0, 2], [0, 3]])).score, 30 + 8 + 10);
  assert.equal(score(mk(8, [[0, 1], [2, 3], [4, 5], [6, 7]])).score, 56);
});

test('all 28 strings on 8 pins = 536', () => {
  const pairs = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) pairs.push([i, j]);
  const r = score(mk(8, pairs));
  assert.equal(r.score, 536);
  assert.equal(r.level, 4);
});

// Build walls with exact scores via disjoint strings (14 per extra... use chains).
// A chain of k strings on k+1 pins: 10k + 2(k+1) + 5(k-1) = 17k - 3.
function chain(k) {
  const pairs = [];
  for (let i = 0; i < k; i++) pairs.push([i, i + 1]);
  return mk(k + 1, pairs);
}

test('thresholds: nearest reachable scores around each threshold', () => {
  const reach = reachable();
  const all = [...reach.keys()].sort((x, y) => x - y);
  THRESHOLDS.forEach((t, level) => {
    if (t === 0) return;
    const below = Math.max(...all.filter((v) => v < t));
    const atOrAbove = Math.min(...all.filter((v) => v >= t));
    assert.equal(score(reach.get(below)).level, level - 1, 'below ' + t);
    assert.equal(score(reach.get(atOrAbove)).level, level, 'at ' + t);
    assert.equal(score(reach.get(atOrAbove)).status, STATUSES[level]);
  });
});

// Fabricate a wall with an exact score: use a fake wall where strings reference pins to hit totals.
// score = 10S + 2C + 5E. Choose S strings among star center to tune; brute force small search.
function reachable() {
  const m = new Map();
  for (let n = 2; n <= 40; n++) for (let s = 1; s <= 60; s++) {
    const w = starWall(n, s);
    if (w) { const v = score(w).score; if (!m.has(v)) m.set(v, w); }
  }
  return m;
}

function starWall(n, s) {
  const pairs = [];
  for (let i = 1; i < n && pairs.length < s; i++) pairs.push([0, i]);
  let a = 1;
  let b = 2;
  while (pairs.length < s && a < n) {
    if (b >= n) { a++; b = a + 1; continue; }
    pairs.push([a, b]);
    b++;
  }
  return pairs.length === s ? mk(n, pairs) : null;
}

function graph(c, strCount) {
  // c connected pins, strCount strings (score = 20*S - 3*C).
  const pairs = [];
  const seen = new Set();
  const add = (a, b) => { if (!seen.has(a + ',' + b)) { seen.add(a + ',' + b); pairs.push([a, b]); } };
  if (strCount >= c - 1) for (let i = 0; i < c - 1; i++) add(i, i + 1);
  else for (let i = 0; i + 1 < c; i += 2) add(i, i + 1);
  for (let a = 0; a < c && pairs.length < strCount; a++) for (let b = a + 1; b < c && pairs.length < strCount; b++) add(a, b);
  return mk(c, pairs);
}

test('exact boundary 200 and 199', () => {
  const at = graph(20, 13);
  assert.equal(score(at).score, 200);
  assert.equal(score(at).level, 4);
  const below = graph(7, 11);
  assert.equal(score(below).score, 199);
  assert.deepEqual(score(below), { score: 199, level: 3, status: 'Cover-up' });
});

test('8-pin loop reaches level 4 monotonically', () => {
  const pairs = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) pairs.push([i, j]);
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let prev = -1;
  let prevScore = -1;
  let reached = 0;
  for (let k = 1; k <= pairs.length; k++) {
    const r = score(mk(8, pairs.slice(0, k)));
    assert.ok(r.level >= prev);
    assert.ok(r.score > prevScore);
    prev = r.level;
    prevScore = r.score;
    if (r.level === 4 && !reached) reached = k;
  }
  assert.ok(reached > 0 && reached <= 28);
});

test('strings touching unknown pins do not add connected pins', () => {
  const w = { pins: [{ id: 'a' }], strings: [{ a: 'a', b: 'ghost' }] };
  assert.equal(score(w).score, 10 + 2);
});
