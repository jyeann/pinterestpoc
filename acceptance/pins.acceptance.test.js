'use strict';
// Pins: create, normalisation, coordinates, limits, move, delete (design.md 2.1, 2.7, 4).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const EMPTY = { code: 'phrase_empty', message: 'Say something. Even a hunch has a word in it.' };
const LONG = { code: 'phrase_too_long', message: 'Too long. Evidence must fit on a card: 60 characters, tops.' };
const post = (id, body, opts) => s.call('POST', `/api/walls/${id}/pins`, body, opts);

test('POST pin returns 201 {pin, score, level, status, version} with the Pin fields', async () => {
  const { id, res } = await H.createWall(s);
  const r = await post(id, { phrase: 'pigeons' });
  assert.equal(r.status, 201);
  const p = r.body.pin;
  assert.match(p.id, /^p[A-Za-z0-9_-]{8}$/);
  assert.equal(p.phrase, 'pigeons');
  assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
  assert.equal(typeof p.art, 'string');
  assert.ok(!Number.isNaN(Date.parse(p.createdAt)));
  assert.equal(r.body.score, 0);
  assert.equal(r.body.level, 0);
  assert.equal(r.body.status, 'Hunch');
  assert.equal(r.body.version, res.body.version + 1);
  const g = (await H.getWall(s, id)).body;
  assert.deepEqual(g.pins, [p]);
});

test('phrase normalisation: NFC, control and zero-width removal, whitespace collapse, case kept', async () => {
  const table = [
    ['  the\t\nmoon ', 'the moon'],
    ['é', 'é'],
    ['a​b', 'ab'],
    ['a‌b‍c⁠d﻿e', 'abcde'],
    ['a\u0001\u0007b', 'ab'],
    ['a \u0007 b', 'a b'],
    ['a 　b', 'a b'],
    ['x\u007f', 'x'],
    ['Pigeons', 'Pigeons'],
    ['one\r\ntwo\tthree', 'one two three'],
  ];
  const { id } = await H.createWall(s);
  for (const [raw, want] of table) {
    const r = await post(id, { phrase: raw });
    assert.equal(r.status, 201, JSON.stringify(raw));
    assert.equal(r.body.pin.phrase, want, JSON.stringify(raw));
  }
});

test('empty after normalisation is 400 phrase_empty with the ux message', async () => {
  const { id } = await H.createWall(s);
  for (const raw of ['', '   ', '\u0007', '\t\n', '​﻿', ' \u0001 ']) {
    const r = await post(id, { phrase: raw });
    assert.equal(r.status, 400, JSON.stringify(raw));
    assert.deepEqual(r.body, { error: EMPTY }, JSON.stringify(raw));
  }
  assert.deepEqual((await H.getWall(s, id)).body.pins, []);
});

test('non-string or missing phrase is 400 phrase_invalid', async () => {
  const { id } = await H.createWall(s);
  for (const body of [{ phrase: 5 }, {}, { phrase: null }, { phrase: ['a'] }, { phrase: { a: 1 } }]) {
    const r = await post(id, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, { error: { code: 'phrase_invalid', message: EMPTY.message } }, JSON.stringify(body));
  }
});

test('length is counted in code points after normalisation: 60 ok, 61 too long', async () => {
  const { id } = await H.createWall(s);
  const ok = await post(id, { phrase: 'a'.repeat(60) });
  assert.equal(ok.status, 201);
  const over = await post(id, { phrase: 'a'.repeat(61) });
  assert.equal(over.status, 400);
  assert.deepEqual(over.body, { error: LONG });
  // astral characters are 1 code point each (2 UTF-16 units)
  assert.equal((await post(id, { phrase: '\u{1F600}'.repeat(60) })).status, 201);
  assert.equal((await post(id, { phrase: '\u{1F600}'.repeat(61) })).body.error.code, 'phrase_too_long');
  // e + combining acute is one code point after NFC
  assert.equal((await post(id, { phrase: 'é'.repeat(60) })).status, 201);
  assert.equal((await post(id, { phrase: 'é'.repeat(61) })).body.error.code, 'phrase_too_long');
  // padding that normalisation removes does not count
  assert.equal((await post(id, { phrase: `   ${'a'.repeat(60)}   ` })).status, 201);
});

test('duplicate phrases are allowed on one wall and get different ids', async () => {
  const { id } = await H.createWall(s);
  const a = await H.addPin(s, id, 'twin');
  const b = await H.addPin(s, id, 'twin');
  assert.equal(a.res.status, 201);
  assert.equal(b.res.status, 201);
  assert.notEqual(a.id, b.id);
});

test('absent x,y get a default inside 100..900, identical for the same phrase on any wall (case-insensitive key)', async () => {
  const w1 = (await H.createWall(s)).id;
  const w2 = (await H.createWall(s)).id;
  const a = (await H.addPin(s, w1, 'Pigeons')).pin;
  const b = (await H.addPin(s, w2, 'pigeons')).pin;
  for (const p of [a, b]) {
    assert.ok(p.x >= 100 && p.x <= 900, `x ${p.x}`);
    assert.ok(p.y >= 100 && p.y <= 900, `y ${p.y}`);
  }
  assert.deepEqual([a.x, a.y], [b.x, b.y]);
});

test('given coordinates are used, clamped to 0..1000 and rounded to integers', async () => {
  const { id } = await H.createWall(s);
  const cases = [
    [[250, 750], [250, 750]],
    [[-5, 1000.6], [0, 1000]],
    [[5000, -80], [1000, 0]],
    [[2.4, 2.6], [2, 3]],
    [[0, 1000], [0, 1000]],
  ];
  for (const [input, want] of cases) {
    const r = await post(id, { phrase: 'pt', x: input[0], y: input[1] });
    assert.equal(r.status, 201, JSON.stringify(input));
    assert.deepEqual([r.body.pin.x, r.body.pin.y], want, JSON.stringify(input));
  }
});

test('bad_coords: one coordinate alone, non-numbers, non-finite', async () => {
  const { id } = await H.createWall(s);
  const bodies = [
    { phrase: 'p', x: 10 }, { phrase: 'p', y: 10 },
    { phrase: 'p', x: '5', y: 5 }, { phrase: 'p', x: 5, y: true }, { phrase: 'p', x: {}, y: 5 },
  ];
  for (const b of bodies) {
    const r = await post(id, b);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.deepEqual(r.body, { error: { code: 'bad_coords', message: 'Position must be numbers.' } }, JSON.stringify(b));
  }
  const inf = await post(id, undefined, { raw: '{"phrase":"p","x":1e999,"y":1}' });
  assert.equal(inf.status, 400);
  assert.equal(inf.body.error.code, 'bad_coords');
});

test('validation order on POST pins: body, wall 404, phrase, coords, wall_full', async () => {
  const { id } = await H.createWall(s);
  const nf = await post('nowall', { phrase: '' });
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'not_found');
  const both = await post(id, { phrase: '', x: 'a', y: 1 });
  assert.equal(both.body.error.code, 'phrase_empty');
  const bj = await post(id, undefined, { raw: '[]' });
  assert.equal(bj.body.error.code, 'bad_json');
  const noBody = await post(id, undefined);
  assert.equal(noBody.status, 400);
  assert.equal(noBody.body.error.code, 'bad_json');
});

test('wall holds 100 pins; the 101st is 400 wall_full, after phrase and coordinate checks', async () => {
  const { id } = await H.createWall(s);
  const ids = await H.addPins(s, id, 100);
  assert.equal(ids.length, 100);
  const full = await post(id, { phrase: 'one more' });
  assert.equal(full.status, 400);
  assert.deepEqual(full.body, { error: { code: 'wall_full', message: 'The wall is full. 100 pins is where the trail goes cold.' } });
  assert.equal((await post(id, { phrase: '' })).body.error.code, 'phrase_empty');
  assert.equal((await post(id, { phrase: 'x', x: 1 })).body.error.code, 'bad_coords');
  const w = (await H.getWall(s, id)).body;
  assert.equal(w.pins.length, 100);
  // deleting one frees a slot
  assert.equal((await s.call('DELETE', `/api/walls/${id}/pins/${ids[0]}`)).status, 200);
  assert.equal((await post(id, { phrase: 'one more' })).status, 201);
});

test('PATCH pin moves it: {pin, ...Meta}, clamp and round, version +1, other fields kept', async () => {
  const { id } = await H.createWall(s);
  const { pin } = await H.addPin(s, id, 'mover', [10, 20]);
  const v0 = (await H.getWall(s, id)).body.version;
  const r = await s.call('PATCH', `/api/walls/${id}/pins/${pin.id}`, { x: 400.4, y: -3 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pin, { ...pin, x: 400, y: 0 });
  assert.equal(r.body.score, 0);
  assert.equal(r.body.status, 'Hunch');
  assert.equal(r.body.version, v0 + 1);
  assert.deepEqual((await H.getWall(s, id)).body.pins[0], r.body.pin);
});

test('PATCH pin errors: bad_coords, unknown pin, unknown wall, pin of another wall', async () => {
  const { id } = await H.createWall(s);
  const other = (await H.createWall(s)).id;
  const { pin } = await H.addPin(s, id, 'target', [5, 5]);
  const bad = await s.call('PATCH', `/api/walls/${id}/pins/${pin.id}`, { x: 'a', y: 2 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_coords');
  assert.equal((await s.call('PATCH', `/api/walls/${id}/pins/pnotthere`, { x: 1, y: 1 })).status, 404);
  assert.equal((await s.call('PATCH', `/api/walls/nowall/pins/${pin.id}`, { x: 1, y: 1 })).status, 404);
  const cross = await s.call('PATCH', `/api/walls/${other}/pins/${pin.id}`, { x: 1, y: 1 });
  assert.equal(cross.status, 404);
  assert.equal(cross.body.error.code, 'not_found');
  const g = (await H.getWall(s, id)).body.pins[0];
  assert.deepEqual([g.x, g.y], [5, 5]);
});

test('DELETE pin returns {id, removedStrings, ...Meta}, cascades its strings, second delete is 404', async () => {
  const { id } = await H.createWall(s);
  const [a, b, c] = await H.addPins(s, id, 3);
  const s1 = (await H.tie(s, id, a, b)).string;
  const s2 = (await H.tie(s, id, a, c)).string;
  const s3 = (await H.tie(s, id, b, c)).string;
  const before = (await H.getWall(s, id)).body;
  const r = await s.call('DELETE', `/api/walls/${id}/pins/${a}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, a);
  assert.deepEqual([...r.body.removedStrings].sort(), [s1.id, s2.id].sort());
  assert.equal(r.body.score, H.scoreOf(2, [[0, 1]]));
  assert.equal(r.body.version, before.version + 1);
  const g = (await H.getWall(s, id)).body;
  assert.deepEqual(g.pins.map((p) => p.id), [b, c]);
  assert.deepEqual(g.strings.map((x) => x.id), [s3.id]);
  const again = await s.call('DELETE', `/api/walls/${id}/pins/${a}`);
  assert.equal(again.status, 404);
  assert.equal(again.body.error.code, 'not_found');
});

test('DELETE pin with no strings returns removedStrings []', async () => {
  const { id } = await H.createWall(s);
  const [a] = await H.addPins(s, id, 1);
  const r = await s.call('DELETE', `/api/walls/${id}/pins/${a}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.removedStrings, []);
});

test('version increases by one per successful mutation and is untouched by failed ones', async () => {
  const { id } = await H.createWall(s);
  let v = (await H.getWall(s, id)).body.version;
  const p1 = await H.addPin(s, id, 'v one');
  assert.equal(p1.res.body.version, v + 1); v += 1;
  const p2 = await H.addPin(s, id, 'v two');
  assert.equal(p2.res.body.version, v + 1); v += 1;
  const t = await H.tie(s, id, p1.id, p2.id);
  assert.equal(t.res.body.version, v + 1); v += 1;
  const mv = await s.call('PATCH', `/api/walls/${id}/pins/${p1.id}`, { x: 1, y: 1 });
  assert.equal(mv.body.version, v + 1); v += 1;
  const cut = await s.call('DELETE', `/api/walls/${id}/strings/${t.string.id}`);
  assert.equal(cut.body.version, v + 1); v += 1;
  await post(id, { phrase: '' });
  await H.tie(s, id, p1.id, p1.id);
  assert.equal((await H.getWall(s, id)).body.version, v);
});
