'use strict';
// Strings: tie, duplicates, validation order, cut, 500 limit (design.md 4).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const post = (id, body, opts) => s.call('POST', `/api/walls/${id}/strings`, body, opts);

test('POST string returns 201 {string:{id,a,b,finding,createdAt}, ...Meta}; 1 string scores 14 (Hunch)', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  const r = await post(id, { a, b });
  assert.equal(r.status, 201);
  const st = r.body.string;
  assert.match(st.id, /^s[A-Za-z0-9_-]{8}$/);
  assert.equal(st.a, a);
  assert.equal(st.b, b);
  assert.equal(typeof st.finding, 'string');
  assert.ok(st.finding.length > 0);
  assert.ok(!Number.isNaN(Date.parse(st.createdAt)));
  assert.equal(r.body.score, 14);
  assert.equal(r.body.level, 0);
  assert.equal(r.body.status, 'Hunch');
  const g = (await H.getWall(s, id)).body;
  assert.deepEqual(g.strings, [st]);
  assert.equal(g.score, 14);
});

test('a and b are stored as given by the first tie', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  const r = await post(id, { a: b, b: a });
  assert.equal(r.body.string.a, b);
  assert.equal(r.body.string.b, a);
});

test('the same unordered pair is 409 duplicate_string, in either order', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  assert.equal((await post(id, { a, b })).status, 201);
  const msg = { error: { code: 'duplicate_string', message: 'Those two are already connected. I checked.' } };
  const same = await post(id, { a, b });
  assert.equal(same.status, 409);
  assert.deepEqual(same.body, msg);
  const rev = await post(id, { a: b, b: a });
  assert.equal(rev.status, 409);
  assert.deepEqual(rev.body, msg);
  assert.equal((await H.getWall(s, id)).body.strings.length, 1);
});

test('self link is 400 self_link, even when the id does not exist', async () => {
  const { id } = await H.createWall(s);
  const [a] = await H.addPins(s, id, 1);
  const msg = { error: { code: 'self_link', message: 'A pin cannot be linked to itself.' } };
  const r = await post(id, { a, b: a });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, msg);
  const ghost = await post(id, { a: 'pnotthere', b: 'pnotthere' });
  assert.equal(ghost.status, 400);
  assert.equal(ghost.body.error.code, 'self_link');
});

test('unknown, missing or foreign pin ids are 400 bad_pin', async () => {
  const { id } = await H.createWall(s);
  const other = (await H.createWall(s)).id;
  const [a] = await H.addPins(s, id, 1);
  const [foreign] = await H.addPins(s, other, 1);
  const msg = { error: { code: 'bad_pin', message: 'Both pins must be on this wall.' } };
  for (const body of [{ a, b: 'pnotthere' }, { a: 'pnotthere', b: a }, { a }, { b: a }, {}, { a, b: foreign }]) {
    const r = await post(id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, msg, JSON.stringify(body));
  }
});

test('validation order on POST strings: body, wall 404, self_link, bad_pin, duplicate, strings_full', async () => {
  const bj = await post('nowall', undefined, { raw: '[]' });
  assert.equal(bj.status, 400);
  assert.equal(bj.body.error.code, 'bad_json');
  const nf = await post('nowall', { a: 'p1', b: 'p1' });
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'not_found');
});

test('DELETE string returns {id, ...Meta}, lowers the score, second delete is 404', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  const st = (await H.tie(s, id, a, b)).string;
  const r = await s.call('DELETE', `/api/walls/${id}/strings/${st.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, st.id);
  assert.equal(r.body.score, 0);
  assert.equal(r.body.status, 'Hunch');
  assert.deepEqual((await H.getWall(s, id)).body.strings, []);
  const again = await s.call('DELETE', `/api/walls/${id}/strings/${st.id}`);
  assert.equal(again.status, 404);
  assert.equal(again.body.error.code, 'not_found');
  assert.equal((await s.call('DELETE', `/api/walls/nowall/strings/${st.id}`)).status, 404);
  // the pair can be tied again after the cut
  assert.equal((await post(id, { a, b })).status, 201);
});

test('a string cannot be cut through another wall', async () => {
  const w1 = (await H.createWall(s)).id;
  const w2 = (await H.createWall(s)).id;
  const [a, b] = await H.addPins(s, w1, 2);
  const st = (await H.tie(s, w1, a, b)).string;
  assert.equal((await s.call('DELETE', `/api/walls/${w2}/strings/${st.id}`)).status, 404);
  assert.equal((await H.getWall(s, w1)).body.strings.length, 1);
});

test('a wall holds 500 strings; the 501st new pair is 400 strings_full, a duplicate is still 409', async () => {
  const { id } = await H.createWall(s);
  const ids = await H.addPins(s, id, 40);
  const pairs = H.allPairs(40);
  for (let i = 0; i < 500; i += 50) {
    const batch = pairs.slice(i, i + 50);
    const out = await Promise.all(batch.map(([x, y]) => post(id, { a: ids[x], b: ids[y] })));
    for (const r of out) assert.equal(r.status, 201);
  }
  const over = await post(id, { a: ids[pairs[500][0]], b: ids[pairs[500][1]] });
  assert.equal(over.status, 400);
  assert.deepEqual(over.body, { error: { code: 'strings_full', message: 'No more string. 500 is where the trail goes cold.' } });
  const dup = await post(id, { a: ids[pairs[0][1]], b: ids[pairs[0][0]] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'duplicate_string');
  assert.equal((await H.getWall(s, id)).body.strings.length, 500);
  // cutting one makes room
  const first = (await H.getWall(s, id)).body.strings[0];
  assert.equal((await s.call('DELETE', `/api/walls/${id}/strings/${first.id}`)).status, 200);
  assert.equal((await post(id, { a: ids[pairs[500][0]], b: ids[pairs[500][1]] })).status, 201);
});
