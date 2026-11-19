'use strict';
// Walls: create, read, rename, error shapes and routing (design.md sections 3, 4).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const MSG = {
  empty: 'Say something. Even a hunch has a word in it.',
  long: 'Too long. Evidence must fit on a card: 60 characters, tops.',
  json: 'Request body must be a JSON object.',
  nf: 'No such case',
};

test('POST /api/walls with no body creates a wall (201, WallJson, default title, Hunch)', async () => {
  const r = await s.call('POST', '/api/walls');
  assert.equal(r.status, 201);
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  const w = r.body;
  assert.match(w.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(w.title, `Case #${w.id}`);
  assert.ok(!Number.isNaN(Date.parse(w.createdAt)));
  assert.deepEqual(w.pins, []);
  assert.deepEqual(w.strings, []);
  assert.equal(w.score, 0);
  assert.equal(w.level, 0);
  assert.equal(w.status, 'Hunch');
  assert.equal(typeof w.version, 'number');
});

test('POST /api/walls with {} also works and wall ids are unique', async () => {
  const a = await s.call('POST', '/api/walls', {});
  const b = await s.call('POST', '/api/walls', {});
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.id, b.body.id);
});

test('POST /api/walls normalises the title like a phrase and ignores unknown fields', async () => {
  const r = await s.call('POST', '/api/walls', { title: '  the\t\nmoon ', evil: { a: 1 } });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'the moon');
});

test('title of 60 code points is accepted, 61 is title_too_long with the ux message', async () => {
  const ok = await s.call('POST', '/api/walls', { title: 'b'.repeat(60) });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.title.length, 60);
  const bad = await s.call('POST', '/api/walls', { title: 'b'.repeat(61) });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: { code: 'title_too_long', message: MSG.long } });
});

test('request bodies are parsed as JSON whatever the content-type', async () => {
  const r = await s.call('POST', '/api/walls', undefined, { raw: '{"title":"plain text body"}', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.title, 'plain text body');
});

test('malformed or non-object bodies are 400 bad_json with the exact message', async () => {
  const bodies = ['not json', '{', '[]', 'null', '"str"', '5', '[{"title":"x"}]'];
  for (const raw of bodies) {
    const r = await s.call('POST', '/api/walls', undefined, { raw });
    assert.equal(r.status, 400, `body ${raw}`);
    assert.deepEqual(r.body, { error: { code: 'bad_json', message: MSG.json } }, `body ${raw}`);
  }
  const bad = await s.call('POST', '/api/walls', undefined, { raw: Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_json');
});

test('GET /api/walls/:id returns the same WallJson as creation', async () => {
  const { res, id } = await H.createWall(s, 'Roundtrip');
  const g = await H.getWall(s, id);
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, res.body);
});

test('unknown wall id is 404 not_found JSON; ids outside the id regex are 404 too', async () => {
  for (const id of ['doesnotexist', 'a'.repeat(32), 'a'.repeat(33), 'a.b', 'a%20b']) {
    const r = await s.call('GET', `/api/walls/${id}`);
    assert.equal(r.status, 404, id);
    assert.deepEqual(r.body, { error: { code: 'not_found', message: MSG.nf } }, id);
  }
});

test('PATCH title returns {title, score, level, status, version} and persists on the wall', async () => {
  const { id, res } = await H.createWall(s);
  const p = await s.call('PATCH', `/api/walls/${id}`, { title: '  Moon   Landing ' });
  assert.equal(p.status, 200);
  assert.equal(p.body.title, 'Moon Landing');
  assert.equal(p.body.score, 0);
  assert.equal(p.body.level, 0);
  assert.equal(p.body.status, 'Hunch');
  assert.equal(p.body.version, res.body.version + 1);
  assert.equal((await H.getWall(s, id)).body.title, 'Moon Landing');
});

test('PATCH title errors: empty, whitespace, too long, bad body, unknown wall', async () => {
  const { id } = await H.createWall(s);
  for (const t of ['', '   ', '\u0007']) {
    const r = await s.call('PATCH', `/api/walls/${id}`, { title: t });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: { code: 'title_empty', message: MSG.empty } });
  }
  const long = await s.call('PATCH', `/api/walls/${id}`, { title: 'z'.repeat(61) });
  assert.equal(long.status, 400);
  assert.equal(long.body.error.code, 'title_too_long');
  const bj = await s.call('PATCH', `/api/walls/${id}`, undefined, { raw: '[1]' });
  assert.equal(bj.status, 400);
  assert.equal(bj.body.error.code, 'bad_json');
  const nf = await s.call('PATCH', '/api/walls/nope', { title: 'x' });
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'not_found');
});

test('a failed PATCH does not change the title or the version', async () => {
  const { id } = await H.createWall(s, 'keep me');
  const before = (await H.getWall(s, id)).body;
  await s.call('PATCH', `/api/walls/${id}`, { title: '' });
  const after = (await H.getWall(s, id)).body;
  assert.equal(after.title, 'keep me');
  assert.equal(after.version, before.version);
});

test('GET /healthz is 200 {"ok":true}', async () => {
  const r = await s.call('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

test('unknown /api path is 404 JSON not_found', async () => {
  for (const p of ['/api/nothing', '/api/walls/abc/unknown']) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.error.code, 'not_found', p);
  }
});

test('known path with the wrong method is 405 method_not_allowed with an Allow header', async () => {
  const { id } = await H.createWall(s);
  const cases = [
    ['GET', '/api/walls', 'POST'],
    ['DELETE', `/api/walls/${id}`, 'GET'],
    ['POST', `/api/walls/${id}/events`, 'GET'],
    ['POST', `/api/walls/${id}/detective`, 'GET'],
  ];
  for (const [method, p, allowed] of cases) {
    const r = await s.call(method, p, method === 'POST' ? {} : undefined);
    assert.equal(r.status, 405, `${method} ${p}`);
    assert.deepEqual(r.body, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    assert.ok(String(r.headers.allow || '').toUpperCase().includes(allowed), `Allow for ${method} ${p}: ${r.headers.allow}`);
  }
});
