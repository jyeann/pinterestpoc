'use strict';
// Score, level and status: score = 10*S + 2*C + 5*sum(max(0,deg-1)); thresholds 0/20/60/120/200 (design 2.5).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const cycle = (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);

// [name, pins, edges, expected score (checked against the formula), expected level]
const GRAPHS = [
  ['one string', 2, [[0, 1]], 14, 0],
  ['two disjoint strings', 4, [[0, 1], [2, 3]], 28, 1],
  ['path of two strings', 3, [[0, 1], [1, 2]], 31, 1],
  ['triangle', 3, [[0, 1], [1, 2], [0, 2]], 51, 1],
  ['four disjoint strings on 8 pins', 8, [[0, 1], [2, 3], [4, 5], [6, 7]], 56, 1],
  ['4 strings on 6 pins', 6, [[0, 1], [1, 2], [3, 4], [4, 5]], 62, 2],
  ['6 strings on 6 pins', 6, [...cycle(6)], 6 * 10 + 12 + 30, 2],
  ['7 strings on 6 pins', 6, [...cycle(6), [0, 3]], 122, 3],
  ['11 strings on 6 pins', 6, H.allPairs(6).slice(0, 11), 202, 4],
];

test('score, level and status match the formula and thresholds for nine graph shapes', async () => {
  for (const [name, n, edges, expected, level] of GRAPHS) {
    assert.equal(H.scoreOf(n, edges), expected, `${name}: test table matches the formula`);
    assert.equal(H.levelOf(expected), level, `${name}: test table matches the thresholds`);
    const { id } = await H.buildGraph(s, n, []);
    const ids = (await H.getWall(s, id)).body.pins.map((p) => p.id);
    let last;
    for (const [i, j] of edges) last = await H.tie(s, id, ids[i], ids[j]);
    assert.equal(last.res.body.score, expected, name);
    assert.equal(last.res.body.level, level, name);
    assert.equal(last.res.body.status, H.STATUSES[level], name);
    const g = (await H.getWall(s, id)).body;
    assert.equal(g.score, expected, name);
    assert.equal(g.level, level, name);
    assert.equal(g.status, H.STATUSES[level], name);
  }
});

test('pins without strings score 0 (only connected pins count)', async () => {
  const { id } = await H.createWall(s);
  await H.addPins(s, id, 5);
  const g = (await H.getWall(s, id)).body;
  assert.equal(g.score, 0);
  assert.equal(g.level, 0);
  assert.equal(g.status, 'Hunch');
});

test('8 pins, all 28 strings: score never drops, level never drops, ends at 536 and level 4', async () => {
  const { id } = await H.createWall(s);
  const ids = await H.addPins(s, id, 8);
  const tied = [];
  let prevScore = 0;
  let prevLevel = 0;
  let reached = -1;
  for (const [i, j] of H.allPairs(8)) {
    const r = await H.tie(s, id, ids[i], ids[j]);
    assert.equal(r.res.status, 201);
    tied.push([i, j]);
    assert.equal(r.res.body.score, H.scoreOf(8, tied), `after ${tied.length} strings`);
    assert.ok(r.res.body.score >= prevScore);
    assert.ok(r.res.body.level >= prevLevel);
    if (r.res.body.level === 4 && reached < 0) reached = tied.length;
    prevScore = r.res.body.score; prevLevel = r.res.body.level;
  }
  assert.equal(prevScore, 536);
  assert.equal(prevLevel, 4);
  assert.ok(reached > 0 && reached < 28, `level 4 reached at string ${reached}`);
});

test('cutting a string lowers the score and may lower the status', async () => {
  const { id, ids } = await H.buildGraph(s, 6, H.allPairs(6).slice(0, 11));
  const w = (await H.getWall(s, id)).body;
  assert.equal(w.level, 4);
  const cut = await s.call('DELETE', `/api/walls/${id}/strings/${w.strings[0].id}`);
  const left = H.allPairs(6).slice(1, 11);
  assert.equal(cut.body.score, H.scoreOf(6, left));
  assert.ok(cut.body.score < w.score);
  assert.equal(cut.body.level, H.levelOf(cut.body.score));
  assert.equal(ids.length, 6);
});

test('deleting a pin removes its strings and rescoring follows the formula', async () => {
  const { id, ids } = await H.buildGraph(s, 5, [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2]]);
  const before = (await H.getWall(s, id)).body;
  assert.equal(before.score, H.scoreOf(5, [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2]]));
  const r = await s.call('DELETE', `/api/walls/${id}/pins/${ids[0]}`);
  assert.equal(r.body.removedStrings.length, 4);
  assert.equal(r.body.score, 14); // only 1-2 remains: 10 + 2*2
  assert.equal((await H.getWall(s, id)).body.score, 14);
});
