'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const H = require('../src/http');

function fakeReq(chunks, headers = {}) {
  const r = Readable.from(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))), { objectMode: false });
  r.headers = headers;
  return r;
}
function fakeRes() {
  const res = { headers: {}, status: null, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (status, h) => {
    res.status = status;
    for (const [k, v] of Object.entries(h || {})) res.headers[k.toLowerCase()] = v;
  };
  res.end = (b) => { res.body = b ? b.toString('utf8') : ''; };
  return res;
}
const mk = (bytes) => {
  const head = '{"pad":"';
  const tail = '"}';
  return head + 'x'.repeat(bytes - head.length - tail.length) + tail;
};

test('security headers are the exact design 5 set', () => {
  const res = fakeRes();
  H.applySecurityHeaders(res);
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('sendError writes the error body shape with status and message from the table', () => {
  const table = {
    bad_json: [400, 'Request body must be a JSON object.'],
    too_large: [413, 'Request body too large.'],
    phrase_empty: [400, 'Say something. Even a hunch has a word in it.'],
    title_empty: [400, 'Say something. Even a hunch has a word in it.'],
    phrase_invalid: [400, 'Say something. Even a hunch has a word in it.'],
    phrase_too_long: [400, 'Too long. Evidence must fit on a card: 60 characters, tops.'],
    title_too_long: [400, 'Too long. Evidence must fit on a card: 60 characters, tops.'],
    wall_full: [400, 'The wall is full. 100 pins is where the trail goes cold.'],
    strings_full: [400, 'No more string. 500 is where the trail goes cold.'],
    bad_coords: [400, 'Position must be numbers.'],
    bad_pin: [400, 'Both pins must be on this wall.'],
    self_link: [400, 'A pin cannot be linked to itself.'],
    duplicate_string: [409, 'Those two are already connected. I checked.'],
    not_found: [404, 'No such case'],
    method_not_allowed: [405, 'Method not allowed.'],
    rate_limited: [429, 'Slow down, detective.'],
    capacity: [503, 'The archive is full.'],
    internal: [500, 'The wall would not talk.'],
  };
  for (const [code, [status, message]] of Object.entries(table)) {
    const res = fakeRes();
    H.sendError(res, code);
    assert.equal(res.status, status, code);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(JSON.parse(res.body), { error: { code, message } }, code);
    assert.equal(res.headers['content-length'], Buffer.byteLength(res.body));
  }
});

test('sendError adds extra headers, closes the connection on 413 only, and maps unknown codes to internal', () => {
  const a = fakeRes();
  H.sendError(a, 'method_not_allowed', { Allow: 'GET' });
  assert.equal(a.headers.allow, 'GET');
  assert.equal(a.headers.connection, undefined);
  const b = fakeRes();
  H.sendError(b, 'too_large');
  assert.equal(b.headers.connection, 'close');
  const c = fakeRes();
  H.sendError(c, 'no_such_code');
  assert.equal(c.status, 500);
  assert.equal(JSON.parse(c.body).error.code, 'internal');
});

test('sendJson and sendHtml set content types and byte lengths', () => {
  const j = fakeRes();
  H.sendJson(j, 201, { a: 'é' });
  assert.equal(j.status, 201);
  assert.equal(j.headers['content-length'], 10);
  assert.equal(j.body, '{"a":"é"}');
  const h = fakeRes();
  H.sendHtml(h, 404, '<p>x</p>');
  assert.equal(h.status, 404);
  assert.equal(h.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(h.body, '<p>x</p>');
});

test('readJsonBody: exactly 4096 bytes is accepted, 4097 is too_large', async () => {
  const ok = await H.readJsonBody(fakeReq([mk(4096)]));
  assert.equal(ok.ok, true);
  assert.equal(ok.value.pad.length, 4096 - 10);
  const over = await H.readJsonBody(fakeReq([mk(4097)]));
  assert.deepEqual(over, { ok: false, code: 'too_large' });
});

test('readJsonBody: the limit counts bytes across chunks and a declared content-length over the limit is refused', async () => {
  const body = mk(4097);
  const chunks = [body.slice(0, 1000), body.slice(1000, 4000), body.slice(4000)];
  assert.equal((await H.readJsonBody(fakeReq(chunks))).code, 'too_large');
  const okBody = mk(4096);
  assert.equal((await H.readJsonBody(fakeReq([okBody.slice(0, 4000), okBody.slice(4000)]))).ok, true);
  const declared = await H.readJsonBody(fakeReq(['{}'], { 'content-length': '4097' }));
  assert.equal(declared.code, 'too_large');
  const exact = await H.readJsonBody(fakeReq(['{}'], { 'content-length': '4096' }));
  assert.equal(exact.ok, true);
  // multi-byte characters count as bytes: 2049 two-byte chars plus the wrapper exceed 4096
  const wide = '{"t":"' + 'é'.repeat(2045) + '"}';
  assert.ok(Buffer.byteLength(wide) > 4096);
  assert.equal((await H.readJsonBody(fakeReq([wide]))).code, 'too_large');
});

test('readJsonBody: custom limit is honoured', async () => {
  assert.equal((await H.readJsonBody(fakeReq(['{"a":1}']), 7)).ok, true);
  assert.equal((await H.readJsonBody(fakeReq(['{"a":10}']), 7)).code, 'too_large');
});

test('readJsonBody: non-object JSON, malformed JSON and non-UTF-8 are bad_json', async () => {
  for (const raw of ['[]', 'null', '"s"', '5', 'true', '{', 'nope', '[{"a":1}]', '  ']) {
    const r = await H.readJsonBody(fakeReq([raw]), 4096, { allowEmpty: true });
    assert.deepEqual(r, { ok: false, code: 'bad_json' }, raw);
  }
  const bad = await H.readJsonBody(fakeReq([Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d])]));
  assert.deepEqual(bad, { ok: false, code: 'bad_json' });
  const bom = await H.readJsonBody(fakeReq([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])]));
  assert.equal(bom.code, 'bad_json');
});

test('readJsonBody: empty body is bad_json unless allowEmpty, in which case it is {}', async () => {
  assert.deepEqual(await H.readJsonBody(fakeReq([])), { ok: false, code: 'bad_json' });
  assert.deepEqual(await H.readJsonBody(fakeReq([]), 4096, { allowEmpty: true }), { ok: true, value: {} });
  assert.deepEqual(await H.readJsonBody(fakeReq(['{"a":[1]}']), 4096, { allowEmpty: true }), { ok: true, value: { a: [1] } });
});

test('readJsonBody: a request that errors or closes early is not ok', async () => {
  const r = new Readable({ read() {} });
  r.headers = {};
  const p = H.readJsonBody(r);
  r.destroy(new Error('boom'));
  assert.equal((await p).ok, false);
  const r2 = new Readable({ read() {} });
  r2.headers = {};
  const p2 = H.readJsonBody(r2);
  r2.push('{"a"');
  r2.destroy();
  assert.equal((await p2).ok, false);
});

test('readBody stops buffering after the limit and drops the stream after a megabyte of discarded data', async () => {
  let destroyed = false;
  const r = new Readable({ read() {} });
  r.headers = {};
  const orig = r.destroy.bind(r);
  r.destroy = (...a) => { destroyed = true; return orig(...a); };
  const p = H.readBody(r, 10);
  r.push(Buffer.alloc(11));
  assert.deepEqual(await p, { ok: false, code: 'too_large' });
  assert.equal(destroyed, false);
  r.push(Buffer.alloc(1024 * 1024));
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setImmediate(res));
  assert.equal(destroyed, true);
});

test('a single chunk beyond the drain cap is too_large and destroys the stream', async () => {
  let destroyed = false;
  const r = new Readable({ read() {} });
  r.headers = {};
  const orig = r.destroy.bind(r);
  r.destroy = (...a) => { destroyed = true; return orig(...a); };
  const p = H.readBody(r, 4096);
  r.push(Buffer.alloc(1024 * 1024 + 1));
  assert.deepEqual(await p, { ok: false, code: 'too_large' });
  assert.equal(destroyed, true);
});
