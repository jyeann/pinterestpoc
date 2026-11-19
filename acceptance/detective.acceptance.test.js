'use strict';
// The Detective: a pure suggestion of the next string (design 2.6 and 4).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const ask = (id) => s.call('GET', `/api/walls/${id}/detective`);
const teaser = (a, b) => `I like ${a} and ${b} together. Nobody ever asks why.`;
const TOO_FEW = { suggestion: null, reason: 'too_few', message: 'Two pins minimum. Even I cannot connect a single dot.' };
const ALL = { suggestion: null, reason: 'all_connected', message: 'Everything is already connected. That is what worries me.' };
// design 2.6: tie-break is the highest fnv1a32("detective:" + k1 + "\0" + k2) with the keys sorted
const dh = (p, q) => { const [k1, k2] = [p.toLowerCase(), q.toLowerCase()].sort(); return H.fnv1a32(`detective:${k1}\u0000${k2}`); };
const pairKey = (sug) => [sug.a, sug.b].sort().join('|');

test('fewer than two pins: declines with too_few', async () => {
  const { id } = await H.createWall(s);
  const none = await ask(id);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, TOO_FEW);
  await H.addPin(s, id, 'lonely');
  assert.deepEqual((await ask(id)).body, TOO_FEW);
});

test('two untied pins: suggests exactly that pair with the teaser in creation order', async () => {
  const { id } = await H.createWall(s);
  const a = await H.addPin(s, id, 'Pigeons');
  const b = await H.addPin(s, id, 'the moon');
  const r = await ask(id);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['suggestion']);
  assert.deepEqual(Object.keys(r.body.suggestion).sort(), ['a', 'b', 'message']);
  assert.equal(pairKey(r.body.suggestion), [a.id, b.id].sort().join('|'));
  assert.equal(r.body.suggestion.message, teaser('Pigeons', 'the moon'));
});

test('every pair tied: declines with all_connected', async () => {
  const { id } = await H.createWall(s);
  const ids = await H.addPins(s, id, 3);
  await H.tieEdges(s, id, ids, H.allPairs(3));
  assert.deepEqual((await ask(id)).body, ALL);
  const two = await H.createWall(s);
  const [a, b] = await H.addPins(s, two.id, 2);
  await H.tie(s, two.id, b, a);
  assert.deepEqual((await ask(two.id)).body, ALL);
});

test('picks the untied pair with the lowest degree sum', async () => {
  const { id } = await H.createWall(s);
  const [p0, p1, p2, p3] = await H.addPins(s, id, 4, 'dot');
  await H.tie(s, id, p0, p1);
  const r = await ask(id);
  // candidates: (0,2)=1 (0,3)=1 (1,2)=1 (1,3)=1 (2,3)=0 -> only (2,3) has sum 0
  assert.equal(pairKey(r.body.suggestion), [p2, p3].sort().join('|'));
  assert.equal(r.body.suggestion.message, teaser('dot 2', 'dot 3'));
});

test('ties on degree sum go to the highest detective hash of the sorted lower-cased keys', async () => {
  const { id } = await H.createWall(s);
  const names = ['Alpha', 'bravo', 'Charlie', 'delta'];
  const ids = [];
  for (const n of names) ids.push((await H.addPin(s, id, n)).id);
  // no strings: all six pairs have sum 0, so the hash decides
  const pairs = H.allPairs(4);
  const hashes = pairs.map(([i, j]) => dh(names[i], names[j]));
  assert.equal(new Set(hashes).size, 6, 'test phrases must give distinct hashes');
  const best = pairs[hashes.indexOf(Math.max(...hashes))];
  const r = await ask(id);
  assert.equal(pairKey(r.body.suggestion), [ids[best[0]], ids[best[1]]].sort().join('|'));
  assert.equal(r.body.suggestion.message, teaser(names[best[0]], names[best[1]]));
});

test('degree beats hash: after tying the hash winner the next pick has the lowest degree sum', async () => {
  const { id } = await H.createWall(s);
  const names = ['Alpha', 'bravo', 'Charlie', 'delta'];
  const ids = [];
  for (const n of names) ids.push((await H.addPin(s, id, n)).id);
  const pairs = H.allPairs(4);
  const tied = [];
  for (let round = 0; round < 6; round += 1) {
    const r = await ask(id);
    assert.ok(r.body.suggestion, `round ${round}`);
    const deg = new Array(4).fill(0);
    tied.forEach(([i, j]) => { deg[i] += 1; deg[j] += 1; });
    const cands = pairs.filter(([i, j]) => !tied.some(([x, y]) => x === i && y === j));
    const min = Math.min(...cands.map(([i, j]) => deg[i] + deg[j]));
    const top = cands.filter(([i, j]) => deg[i] + deg[j] === min);
    const best = top.reduce((m, c) => (dh(names[c[0]], names[c[1]]) > dh(names[m[0]], names[m[1]]) ? c : m));
    assert.equal(pairKey(r.body.suggestion), [ids[best[0]], ids[best[1]]].sort().join('|'), `round ${round}`);
    const t = await H.tie(s, id, r.body.suggestion.a, r.body.suggestion.b);
    assert.equal(t.res.status, 201);
    tied.push(best);
  }
  assert.deepEqual((await ask(id)).body, ALL);
});

test('asking does not mutate the wall and is repeatable', async () => {
  const { id } = await H.createWall(s);
  await H.addPins(s, id, 3);
  const before = (await H.getWall(s, id)).body;
  const r1 = await ask(id);
  const r2 = await ask(id);
  assert.deepEqual(r1.body, r2.body);
  assert.deepEqual((await H.getWall(s, id)).body, before);
});

test('unknown wall is 404 not_found', async () => {
  const r = await ask('nowall');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
});
