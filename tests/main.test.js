'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, parsePort } = require('../src/main');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-main-'));
const sink = () => { const s = { text: '', write(t) { s.text += t; } }; return s; };
const post = (base, p, body) => fetch(base + p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

test('parsePort: default 3000, 0 allowed, integers 0..65535 only', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort(''), 3000);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('8080'), 8080);
  assert.equal(parsePort('65535'), 65535);
  for (const bad of ['65536', '-1', 'abc', '1.5']) assert.throws(() => parsePort(bad), /PORT/, bad);
});

test('start listens on a free port, prints exactly one listening line, serves /healthz, and stops', async () => {
  const out = sink();
  const app = await start({ env: { PORT: '0', RATE_LIMIT: '0' }, out });
  try {
    assert.ok(app.port > 0);
    assert.equal(out.text, `listening on http://127.0.0.1:${app.port}\n`);
    const r = await fetch(`http://127.0.0.1:${app.port}/healthz`);
    assert.deepEqual(await r.json(), { ok: true });
  } finally {
    await app.stop();
  }
  assert.equal(app.server.listening, false);
  await app.stop(); // idempotent
});

test('HOST is honoured in the listening line', async () => {
  const out = sink();
  const app = await start({ env: { PORT: '0', HOST: '127.0.0.1' }, out });
  try {
    assert.equal(out.text.trim(), `listening on http://127.0.0.1:${app.port}`);
  } finally { await app.stop(); }
});

test('RATE_LIMIT=0 disables the limiter, otherwise a burst past 120 is limited', async () => {
  const off = await start({ env: { PORT: '0', RATE_LIMIT: '0' }, out: sink() });
  const on = await start({ env: { PORT: '0' }, out: sink() });
  try {
    const burst = async (app) => (await Promise.all(Array.from({ length: 160 }, () => post(`http://127.0.0.1:${app.port}`, '/api/walls')))).map((r) => r.status);
    const a = await burst(off);
    assert.ok(a.every((s) => s === 201));
    const b = await burst(on);
    assert.equal(b.filter((s) => s === 201).length >= 120, true);
    assert.ok(b.includes(429));
  } finally { await off.stop(); await on.stop(); }
});

test('an invalid PORT rejects instead of listening', async () => {
  await assert.rejects(start({ env: { PORT: 'nope' }, out: sink() }), /PORT/);
});

test('a port that is already taken rejects', async () => {
  const first = await start({ env: { PORT: '0' }, out: sink() });
  try {
    await assert.rejects(start({ env: { PORT: String(first.port) }, out: sink() }), /EADDRINUSE/);
  } finally { await first.stop(); }
});

test('RED_STRING_DATA: state is flushed on stop and reloaded on the next start', async () => {
  const dir = tmp();
  const file = path.join(dir, 'data.json');
  const env = { PORT: '0', RATE_LIMIT: '0', RED_STRING_DATA: file };
  try {
    let app = await start({ env, out: sink() });
    let base = `http://127.0.0.1:${app.port}`;
    const w = await (await post(base, '/api/walls', { title: 'Persisted' })).json();
    await post(base, `/api/walls/${w.id}/pins`, { phrase: 'Zebra' });
    await app.stop();
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).walls[0].pins[0].phrase, 'Zebra');
    assert.deepEqual(fs.readdirSync(dir), ['data.json']);
    app = await start({ env, out: sink() });
    base = `http://127.0.0.1:${app.port}`;
    const again = await (await fetch(`${base}/api/walls/${w.id}`)).json();
    assert.equal(again.title, 'Persisted');
    assert.deepEqual(again.pins.map((p) => p.phrase), ['Zebra']);
    await app.stop();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a corrupt data file is moved aside, logged once, and the server starts empty', async () => {
  const dir = tmp();
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, '{ not json');
  const logs = [];
  const app = await start({ env: { PORT: '0', RED_STRING_DATA: file }, out: sink(), log: (l) => logs.push(l) });
  try {
    assert.equal(logs.length, 1);
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/healthz`)).status, 200);
    const moved = fs.readdirSync(dir).filter((f) => /^data\.json\.corrupt-\d+$/.test(f));
    assert.equal(moved.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, moved[0]), 'utf8'), '{ not json');
  } finally {
    await app.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stop ends open event streams', async () => {
  const app = await start({ env: { PORT: '0', RATE_LIMIT: '0' }, out: sink() });
  const base = `http://127.0.0.1:${app.port}`;
  const w = await (await post(base, '/api/walls')).json();
  const res = await fetch(`${base}/api/walls/${w.id}/events`);
  const reader = res.body.getReader();
  await reader.read();
  const closed = (async () => { for (;;) { const { done } = await reader.read().catch(() => ({ done: true })); if (done) return true; } })();
  await app.stop();
  assert.equal(await closed, true);
});

test('stop flushes again after the server closed: a change accepted during shutdown is saved', async () => {
  const net = require('node:net');
  const dir = tmp();
  const file = path.join(dir, 'data.json');
  const app = await start({ env: { PORT: '0', RATE_LIMIT: '0', RED_STRING_DATA: file }, out: sink() });
  try {
    const body = JSON.stringify({ title: 'Late' });
    const sock = net.connect(app.port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    sock.on('error', () => {});
    sock.write(`POST /api/walls HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n`);
    await new Promise((r) => setTimeout(r, 30));
    const stopping = app.stop();
    setTimeout(() => sock.write(body), 120); // after the first flush, before the 200 ms forced close
    await stopping;
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).walls[0].title, 'Late');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
