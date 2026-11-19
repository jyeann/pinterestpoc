'use strict';
// Security headers, body limits, rate limit, capacity, logging, lifecycle (design 3, 5, 6).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const checkHeaders = (headers, label) => {
  assert.equal(headers['content-security-policy'], CSP, `CSP on ${label}`);
  assert.equal(headers['x-content-type-options'], 'nosniff', `nosniff on ${label}`);
  assert.equal(headers['referrer-policy'], 'no-referrer', `referrer-policy on ${label}`);
};

test('security headers are on pages, API successes, API errors, static files and 404s', async () => {
  const { id } = await H.createWall(s);
  const reqs = [
    ['GET', '/'], ['GET', '/healthz'], ['GET', `/w/${id}`], ['GET', `/w/${id}/case`], ['GET', '/w/nope'], ['GET', '/w/nope/case'],
    ['GET', `/api/walls/${id}`], ['GET', '/api/walls/nope'], ['GET', '/api/walls'], ['GET', '/api/unknown'],
    ['GET', `/api/walls/${id}/detective`], ['GET', '/static/wall.js'], ['GET', '/static/missing.js'], ['GET', '/nothing-here'],
  ];
  for (const [m, p] of reqs) {
    const r = await s.call(m, p);
    checkHeaders(r.headers, `${m} ${p} (${r.status})`);
  }
  const created = await s.call('POST', '/api/walls', { title: 'x' });
  checkHeaders(created.headers, 'POST /api/walls');
  const bad = await s.call('POST', '/api/walls', undefined, { raw: 'nope' });
  assert.equal(bad.status, 400);
  checkHeaders(bad.headers, 'bad_json');
  const big = await s.call('POST', '/api/walls', undefined, { raw: JSON.stringify({ pad: 'x'.repeat(5000) }) });
  assert.equal(big.status, 413);
  checkHeaders(big.headers, '413');
});

test('the event stream carries the security headers too', async () => {
  const { id } = await H.createWall(s);
  const es = await H.openEvents(s, id);
  try {
    assert.equal(es.res.headers.get('content-security-policy'), CSP);
    assert.equal(es.res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(es.res.headers.get('referrer-policy'), 'no-referrer');
  } finally { es.close(); }
});

test('every JSON response, success or error, is application/json; charset=utf-8', async () => {
  const { id } = await H.createWall(s);
  for (const [m, p, b] of [['GET', `/api/walls/${id}`], ['GET', '/api/walls/nope'], ['POST', `/api/walls/${id}/pins`, { phrase: '' }], ['GET', '/healthz'], ['GET', '/api/nothing']]) {
    const r = await s.call(m, p, b);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8', `${m} ${p}`);
  }
});

test('request body: exactly 4096 bytes is accepted, 4097 is 413 too_large', async () => {
  const mk = (bytes) => {
    const head = '{"title":"a","pad":"';
    const tail = '"}';
    return head + 'x'.repeat(bytes - head.length - tail.length) + tail;
  };
  const ok = mk(4096);
  assert.equal(Buffer.byteLength(ok), 4096);
  const accepted = await s.call('POST', '/api/walls', undefined, { raw: ok });
  assert.equal(accepted.status, 201);
  const over = mk(4097);
  assert.equal(Buffer.byteLength(over), 4097);
  const r = await s.call('POST', '/api/walls', undefined, { raw: over });
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: { code: 'too_large', message: 'Request body too large.' } });
  // a much larger body is refused the same way and the server keeps serving
  const huge = await s.call('POST', '/api/walls', undefined, { raw: mk(4097).replace(/x+/, 'x'.repeat(20000)) });
  assert.equal(huge.status, 413);
  assert.equal((await s.call('GET', '/healthz')).status, 200);
});

test('the body limit applies to every mutating route', async () => {
  const { id } = await H.createWall(s);
  const [a] = await H.addPins(s, id, 1);
  const pad = JSON.stringify({ pad: 'x'.repeat(4100) });
  for (const [m, p] of [['PATCH', `/api/walls/${id}`], ['POST', `/api/walls/${id}/pins`], ['PATCH', `/api/walls/${id}/pins/${a}`], ['POST', `/api/walls/${id}/strings`]]) {
    const r = await s.call(m, p, undefined, { raw: pad });
    assert.equal(r.status, 413, `${m} ${p}`);
    assert.equal(r.body.error.code, 'too_large');
  }
});

test('with RATE_LIMIT=0 a burst of 300 mutations is never limited', async () => {
  const out = await Promise.all(Array.from({ length: 300 }, () => s.call('POST', '/api/walls')));
  assert.ok(out.every((r) => r.status === 201));
});

test('the rate limiter answers 429 rate_limited with Retry-After 1, only for mutating requests', async () => {
  const lim = await H.startServer({ rateLimit: true });
  try {
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      out.push(...await Promise.all(Array.from({ length: 100 }, () => lim.call('POST', '/api/walls'))));
    }
    const ok = out.filter((r) => r.status === 201).length;
    const limited = out.filter((r) => r.status === 429);
    assert.ok(ok >= 100, `a burst of about 120 is allowed, got ${ok}`);
    assert.ok(limited.length > 0, 'a 400-request burst must hit the limit');
    assert.deepEqual(limited[0].body, { error: { code: 'rate_limited', message: 'Slow down, detective.' } });
    assert.equal(limited[0].headers['retry-after'], '1');
    assert.ok(out.every((r) => r.status === 201 || r.status === 429));
    // reads are not limited
    for (let i = 0; i < 10; i += 1) assert.equal((await lim.call('GET', '/healthz')).status, 200);
  } finally { await lim.stop(); }
});

test('10 000 walls per process: the 10 001st is 503 capacity and existing walls still work', async () => {
  const cap = await H.startServer();
  try {
    let first;
    for (let done = 0; done < 10000; done += 250) {
      const out = await Promise.all(Array.from({ length: 250 }, () => cap.call('POST', '/api/walls')));
      for (const r of out) assert.equal(r.status, 201);
      if (!first) first = out[0].body.id;
    }
    const over = await cap.call('POST', '/api/walls');
    assert.equal(over.status, 503);
    assert.deepEqual(over.body, { error: { code: 'capacity', message: 'The archive is full.' } });
    assert.equal((await cap.call('GET', `/api/walls/${first}`)).status, 200);
    assert.equal((await cap.call('POST', `/api/walls/${first}/pins`, { phrase: 'still works' })).status, 201);
  } finally { await cap.stop(); }
});

test('startup prints exactly one line "listening on http://127.0.0.1:<port>"', async () => {
  const own = await H.startServer();
  try {
    const lines = own.logs().stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, lines.join('|'));
    assert.match(lines[0], /^listening on http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(lines[0], `listening on http://127.0.0.1:${own.port}`);
  } finally { await own.stop(); }
});

test('logs hold no user data (phrases, titles) even after errors', async () => {
  const own = await H.startServer();
  const { id } = await H.createWall(own, 'TITLE-MARKER-QQ');
  await H.addPin(own, id, 'PHRASE-MARKER-QQ');
  await H.addPin(own, id, '');
  await own.call('POST', '/api/walls', undefined, { raw: '{"title":"BODY-MARKER-QQ"' });
  await own.call('GET', '/w/WALLID-MARKER');
  const info = await own.stop();
  assert.equal(info.code, 0);
  const { stdout, stderr } = own.logs();
  for (const marker of ['TITLE-MARKER-QQ', 'PHRASE-MARKER-QQ', 'BODY-MARKER-QQ']) {
    assert.ok(!stdout.includes(marker) && !stderr.includes(marker), marker);
  }
});

test('SIGTERM exits 0 promptly and SIGINT does too', async () => {
  for (const sig of ['SIGTERM', 'SIGINT']) {
    const own = await H.startServer();
    await H.createWall(own);
    const t0 = Date.now();
    own.child.kill(sig);
    const info = await new Promise((resolve) => own.child.once('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(info.code, 0, sig);
    assert.ok(Date.now() - t0 < 6000, `${sig} exit within a few seconds`);
  }
});
