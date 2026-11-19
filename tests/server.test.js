'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { createStore } = require('../src/store');
const { createRateLimiter } = require('../src/ratelimit');
const { createHub } = require('../src/sse');

const pub = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-server-'));
fs.writeFileSync(path.join(pub, 'index.html'), '<p>home</p>');
fs.writeFileSync(path.join(pub, 'wall.js'), 'x');
const pages = {
  notFoundHtml: () => '<p>NF</p>',
  wallShellHtml: (id) => `<p>SHELL ${id}</p>`,
  caseFileHtml: (w) => `<p>CASE ${w.id} ${w.pins.length}</p>`,
};

let server; let base; let store; let saves;
before(async () => {
  store = createStore();
  saves = 0;
  server = createServer({ store, persist: { scheduleSave: () => { saves += 1; } }, rateLimit: null, publicDir: pub, pages });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.hub.closeAll();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(pub, { recursive: true, force: true });
});

async function call(method, p, body, headers = {}) {
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, headers: res.headers, text, json };
}
const err = (r) => r.json.error.code;

test('walls: create, read, rename over HTTP with the exact shapes', async () => {
  const c = await call('POST', '/api/walls', '');
  assert.equal(c.status, 201);
  assert.equal(c.headers.get('content-type'), 'application/json; charset=utf-8');
  const id = c.json.id;
  assert.deepEqual((await call('GET', `/api/walls/${id}`)).json, c.json);
  const p = await call('PATCH', `/api/walls/${id}`, { title: 'New' });
  assert.deepEqual(p.json, { title: 'New', score: 0, level: 0, status: 'Hunch', version: c.json.version + 1 });
  assert.equal((await call('POST', '/api/walls', { title: 'T' })).json.title, 'T');
});

test('pins and strings: status codes, bodies and the error order through the server', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  const a = await call('POST', `/api/walls/${id}/pins`, { phrase: 'Pigeons', x: 1, y: 2 });
  const b = await call('POST', `/api/walls/${id}/pins`, { phrase: 'the moon' });
  assert.equal(a.status, 201);
  assert.deepEqual(Object.keys(a.json).sort(), ['level', 'pin', 'score', 'status', 'version']);
  const t = await call('POST', `/api/walls/${id}/strings`, { a: a.json.pin.id, b: b.json.pin.id });
  assert.equal(t.status, 201);
  assert.equal(t.json.score, 14);
  assert.equal(err(await call('POST', `/api/walls/${id}/strings`, { a: b.json.pin.id, b: a.json.pin.id })), 'duplicate_string');
  assert.equal((await call('POST', `/api/walls/${id}/strings`, { a: 'x', b: 'x' })).status, 400);
  assert.equal(err(await call('POST', `/api/walls/${id}/strings`, { a: 'x' })), 'bad_pin');
  const mv = await call('PATCH', `/api/walls/${id}/pins/${a.json.pin.id}`, { x: 5000, y: 3 });
  assert.equal(mv.json.pin.x, 1000);
  assert.equal(err(await call('PATCH', `/api/walls/${id}/pins/${a.json.pin.id}`, { x: 1 })), 'bad_coords');
  const del = await call('DELETE', `/api/walls/${id}/pins/${a.json.pin.id}`);
  assert.deepEqual(del.json.removedStrings, [t.json.string.id]);
  assert.equal((await call('DELETE', `/api/walls/${id}/pins/${a.json.pin.id}`)).status, 404);
  assert.equal((await call('DELETE', `/api/walls/${id}/strings/${t.json.string.id}`)).status, 404);
});

test('body is validated before the wall lookup; bodies must be objects; 413 over 4096 bytes closes the connection', async () => {
  assert.equal(err(await call('POST', '/api/walls/nowall/pins', '[]')), 'bad_json');
  assert.equal(err(await call('POST', '/api/walls/nowall/pins', { phrase: 'x' })), 'not_found');
  assert.equal(err(await call('POST', '/api/walls', 'null')), 'bad_json');
  const over = await call('POST', '/api/walls', JSON.stringify({ pad: 'x'.repeat(4100) }));
  assert.equal(over.status, 413);
  assert.equal(over.headers.get('connection'), 'close');
  assert.equal(err(over), 'too_large');
  assert.equal((await call('GET', '/healthz')).status, 200);
});

test('routing: 404 JSON under /api, 404 html elsewhere, 405 with Allow, ids outside the regex are 404', async () => {
  const nf = await call('GET', '/api/nothing');
  assert.equal(nf.status, 404);
  assert.equal(err(nf), 'not_found');
  const page = await call('GET', '/nothing-here');
  assert.equal(page.status, 404);
  assert.equal(page.text, '<p>NF</p>');
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const na = await call('GET', '/api/walls');
  assert.equal(na.status, 405);
  assert.equal(na.headers.get('allow'), 'POST');
  assert.equal(err(na), 'method_not_allowed');
  assert.equal(err(await call('GET', `/api/walls/${'a'.repeat(33)}`)), 'not_found');
  assert.equal((await call('GET', `/w/${'a'.repeat(33)}`)).status, 404);
});

test('pages: home from public/index.html, shell, case file, not-found for unknown walls, static files', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  assert.equal((await call('GET', '/')).text, '<p>home</p>');
  for (const p of [`/w/${id}`, `/w/${id}/`]) assert.equal((await call('GET', p)).text, `<p>SHELL ${id}</p>`, p);
  assert.equal((await call('GET', `/w/${id}/case`)).text, `<p>CASE ${id} 0</p>`);
  for (const p of ['/w/nope', '/w/nope/', '/w/nope/case']) {
    const r = await call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.text, '<p>NF</p>');
  }
  const s = await call('GET', '/static/wall.js');
  assert.equal(s.status, 200);
  assert.equal(s.text, 'x');
  for (const p of ['/static/', '/static/missing.js', '/static/index.txt']) assert.equal(err(await call('GET', p)), 'not_found', p);
});

test('security headers are on every kind of response', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  for (const [m, p] of [['GET', '/'], ['GET', '/healthz'], ['GET', `/w/${id}`], ['GET', '/w/zz'], ['GET', '/api/zz'], ['GET', '/static/wall.js'], ['GET', '/static/no.js'], ['DELETE', '/api/walls']]) {
    const r = await call(m, p);
    assert.match(r.headers.get('content-security-policy'), /^default-src 'none'; script-src 'self'/, p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  }
});

test('detective endpoint shapes', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  assert.deepEqual((await call('GET', `/api/walls/${id}/detective`)).json, { suggestion: null, reason: 'too_few', message: 'Two pins minimum. Even I cannot connect a single dot.' });
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'a' });
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'b' });
  const r = await call('GET', `/api/walls/${id}/detective`);
  assert.deepEqual(Object.keys(r.json), ['suggestion']);
  assert.equal(r.json.suggestion.message, 'I like a and b together. Nobody ever asks why.');
  assert.equal(err(await call('GET', '/api/walls/nope/detective')), 'not_found');
});

test('mutations notify persistence; reads and failures do not', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  const n = saves;
  await call('GET', `/api/walls/${id}`);
  await call('POST', `/api/walls/${id}/pins`, { phrase: '' });
  assert.equal(saves, n);
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'ok' });
  assert.equal(saves, n + 1);
});

test('SSE: snapshot first, then events with by from X-Client-Id (valid only), 404 for unknown walls', async () => {
  const id = (await call('POST', '/api/walls')).json.id;
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/walls/${id}/events`, { signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const reader = res.body.getReader();
  let raw = '';
  const dec = new TextDecoder();
  const until = async (re) => {
    const end = Date.now() + 5000;
    while (!re.test(raw)) {
      if (Date.now() > end) throw new Error(`timeout waiting for ${re}; got ${raw}`);
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
    }
  };
  await until(/event: snapshot\ndata: .*\n\n/);
  assert.ok(raw.startsWith('retry: 1000\n\n'));
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'one' }, { 'x-client-id': 'cli-1' });
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'two' }, { 'x-client-id': 'bad id!' });
  await call('POST', `/api/walls/${id}/pins`, { phrase: 'three' });
  await until(/"phrase":"three"/);
  const bys = [...raw.matchAll(/event: pin-added\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]).by);
  assert.deepEqual(bys, ['cli-1', null, null]);
  assert.equal(err(await call('GET', '/api/walls/nope/events')), 'not_found');
  ctrl.abort();
});

test('SSE: the subscriber cap answers 503 capacity JSON; an injected hub is used', async () => {
  const hub = createHub({ heartbeatMs: 0, maxPerWall: 1 });
  const s2 = createServer({ store: createStore(), rateLimit: null, publicDir: pub, pages, hub });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${s2.address().port}`;
  try {
    const w = await (await fetch(`${b2}/api/walls`, { method: 'POST' })).json();
    const ctrl = new AbortController();
    const first = await fetch(`${b2}/api/walls/${w.id}/events`, { signal: ctrl.signal });
    assert.equal(first.status, 200);
    const second = await fetch(`${b2}/api/walls/${w.id}/events`);
    assert.equal(second.status, 503);
    assert.deepEqual(await second.json(), { error: { code: 'capacity', message: 'The archive is full.' } });
    assert.equal(hub.count(w.id), 1);
    ctrl.abort();
  } finally {
    hub.closeAll();
    s2.closeAllConnections();
    await new Promise((r) => s2.close(r));
  }
});

test('rate limit applies to mutating requests only and answers 429 with Retry-After', async () => {
  let t = 0;
  const limited = createServer({ store: createStore(), rateLimit: createRateLimiter({ capacity: 2, now: () => t }), publicDir: pub, pages });
  await new Promise((r) => limited.listen(0, '127.0.0.1', r));
  const b3 = `http://127.0.0.1:${limited.address().port}`;
  try {
    assert.equal((await fetch(`${b3}/api/walls`, { method: 'POST' })).status, 201);
    assert.equal((await fetch(`${b3}/api/walls`, { method: 'POST' })).status, 201);
    const over = await fetch(`${b3}/api/walls`, { method: 'POST' });
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('retry-after'), '1');
    assert.deepEqual(await over.json(), { error: { code: 'rate_limited', message: 'Slow down, detective.' } });
    for (let i = 0; i < 5; i += 1) assert.equal((await fetch(`${b3}/healthz`)).status, 200);
    t += 1000;
    assert.equal((await fetch(`${b3}/api/walls`, { method: 'POST' })).status, 201);
  } finally {
    limited.closeAllConnections();
    await new Promise((r) => limited.close(r));
  }
});

test('a handler that throws is a 500 internal JSON error and the server keeps running', async () => {
  const broken = createStore();
  broken.getWall = () => { throw new Error('boom'); };
  const s4 = createServer({ store: broken, rateLimit: null, publicDir: pub, pages });
  await new Promise((r) => s4.listen(0, '127.0.0.1', r));
  const b4 = `http://127.0.0.1:${s4.address().port}`;
  try {
    const r = await fetch(`${b4}/api/walls/abc`);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: { code: 'internal', message: 'The wall would not talk.' } });
    assert.equal((await fetch(`${b4}/healthz`)).status, 200);
  } finally {
    s4.closeAllConnections();
    await new Promise((r) => s4.close(r));
  }
});
