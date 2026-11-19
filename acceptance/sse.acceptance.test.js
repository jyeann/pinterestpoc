'use strict';
// Server-Sent Events: GET /api/walls/:id/events (design 4.1).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const open = async (wallId, opts) => {
  const es = await H.openEvents(s, wallId, opts);
  await es.waitEvent((e) => e.event === 'snapshot');
  return es;
};
const names = (es) => es.events.map((e) => e.event);

test('headers: event-stream, no-store, x-accel-buffering no; first write is "retry: 1000"; then a snapshot', async () => {
  const { id } = await H.createWall(s);
  const es = await open(id);
  try {
    assert.equal(es.res.status, 200);
    assert.match(es.res.headers.get('content-type'), /^text\/event-stream/);
    assert.equal(es.res.headers.get('cache-control'), 'no-store');
    assert.equal(es.res.headers.get('x-accel-buffering'), 'no');
    assert.ok(es.raw.startsWith('retry: 1000\n\n'), JSON.stringify(es.raw.slice(0, 60)));
    assert.equal(names(es)[0], 'snapshot');
  } finally { es.close(); }
});

test('snapshot data is the WallJson and the event id is the wall version', async () => {
  const { id } = await H.createWall(s, 'Snap');
  const [a, b] = await H.addPins(s, id, 2);
  await H.tie(s, id, a, b);
  const es = await open(id);
  try {
    const snap = es.events.find((e) => e.event === 'snapshot');
    const wall = (await H.getWall(s, id)).body;
    assert.deepEqual(snap.data, wall);
    assert.equal(snap.id, String(wall.version));
    assert.ok(!snap.dataText.includes('\n'));
  } finally { es.close(); }
});

test('pin-added carries {pin, by, score, level, status, version}; id equals version; by echoes X-Client-Id', async () => {
  const { id } = await H.createWall(s);
  const es = await open(id);
  try {
    const r = await s.call('POST', `/api/walls/${id}/pins`, { phrase: 'pigeons' }, { clientId: 'tester-1' });
    const ev = await es.waitEvent((e) => e.event === 'pin-added');
    assert.deepEqual(ev.data.pin, r.body.pin);
    assert.equal(ev.data.by, 'tester-1');
    assert.equal(ev.data.score, 0);
    assert.equal(ev.data.level, 0);
    assert.equal(ev.data.status, 'Hunch');
    assert.equal(ev.data.version, r.body.version);
    assert.equal(ev.id, String(r.body.version));
  } finally { es.close(); }
});

test('by is null when the request has no X-Client-Id', async () => {
  const { id } = await H.createWall(s);
  const es = await open(id);
  try {
    await s.call('POST', `/api/walls/${id}/pins`, { phrase: 'anon' });
    const ev = await es.waitEvent((e) => e.event === 'pin-added');
    assert.equal(ev.data.by, null);
  } finally { es.close(); }
});

test('pin-moved carries {id, x, y, by, ...Meta} with the clamped values', async () => {
  const { id } = await H.createWall(s);
  const { id: pid } = await H.addPin(s, id, 'mover', [1, 1]);
  const es = await open(id);
  try {
    const r = await s.call('PATCH', `/api/walls/${id}/pins/${pid}`, { x: 2000, y: 77 }, { clientId: 'mv-1' });
    const ev = await es.waitEvent((e) => e.event === 'pin-moved');
    assert.equal(ev.data.id, pid);
    assert.equal(ev.data.x, 1000);
    assert.equal(ev.data.y, 77);
    assert.equal(ev.data.by, 'mv-1');
    assert.equal(ev.data.version, r.body.version);
    assert.equal(ev.data.status, 'Hunch');
  } finally { es.close(); }
});

test('string-added and string-removed carry the string, ids, by and Meta', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  const es = await open(id);
  try {
    const t = await s.call('POST', `/api/walls/${id}/strings`, { a, b }, { clientId: 'tie-1' });
    const added = await es.waitEvent((e) => e.event === 'string-added');
    assert.deepEqual(added.data.string, t.body.string);
    assert.equal(added.data.by, 'tie-1');
    assert.equal(added.data.score, 14);
    assert.equal(added.data.version, t.body.version);
    const c = await s.call('DELETE', `/api/walls/${id}/strings/${t.body.string.id}`, undefined, { clientId: 'cut-1' });
    const removed = await es.waitEvent((e) => e.event === 'string-removed');
    assert.equal(removed.data.id, t.body.string.id);
    assert.equal(removed.data.by, 'cut-1');
    assert.equal(removed.data.score, 0);
    assert.equal(removed.data.version, c.body.version);
  } finally { es.close(); }
});

test('pin-removed carries {id, phrase, removedStrings, by, ...Meta}', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2, 'gone');
  const st = (await H.tie(s, id, a, b)).string;
  const es = await open(id);
  try {
    const r = await s.call('DELETE', `/api/walls/${id}/pins/${a}`, undefined, { clientId: 'del-1' });
    const ev = await es.waitEvent((e) => e.event === 'pin-removed');
    assert.equal(ev.data.id, a);
    assert.equal(ev.data.phrase, 'gone 0');
    assert.deepEqual(ev.data.removedStrings, [st.id]);
    assert.equal(ev.data.by, 'del-1');
    assert.equal(ev.data.score, 0);
    assert.equal(ev.data.version, r.body.version);
  } finally { es.close(); }
});

test('title event carries {title, by, ...Meta}', async () => {
  const { id } = await H.createWall(s);
  const es = await open(id);
  try {
    const r = await s.call('PATCH', `/api/walls/${id}`, { title: 'New Name' }, { clientId: 'ttl-1' });
    const ev = await es.waitEvent((e) => e.event === 'title');
    assert.equal(ev.data.title, 'New Name');
    assert.equal(ev.data.by, 'ttl-1');
    assert.equal(ev.data.version, r.body.version);
  } finally { es.close(); }
});

test('events are published before the HTTP response and failed requests publish nothing', async () => {
  const { id } = await H.createWall(s);
  const es = await open(id);
  try {
    const bad = await s.call('POST', `/api/walls/${id}/pins`, { phrase: '' });
    assert.equal(bad.status, 400);
    const ok = await s.call('POST', `/api/walls/${id}/pins`, { phrase: 'good' });
    assert.equal(ok.status, 201);
    await es.waitEvent((e) => e.event === 'pin-added');
    assert.deepEqual(names(es), ['snapshot', 'pin-added']);
  } finally { es.close(); }
});

test('subscribers only hear their own wall', async () => {
  const w1 = (await H.createWall(s)).id;
  const w2 = (await H.createWall(s)).id;
  const e1 = await open(w1);
  const e2 = await open(w2);
  try {
    await H.addPin(s, w1, 'only on one');
    await e1.waitEvent((e) => e.event === 'pin-added');
    await H.addPin(s, w2, 'only on two');
    const ev = await e2.waitEvent((e) => e.event === 'pin-added');
    assert.equal(ev.data.pin.phrase, 'only on two');
    assert.equal(e2.events.filter((e) => e.event === 'pin-added').length, 1);
  } finally { e1.close(); e2.close(); }
});

test('unknown wall is a 404 JSON error, not a stream', async () => {
  const r = await s.call('GET', '/api/walls/nowall/events');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
});

test('50 subscribers per wall; the 51st is 503 capacity; a freed slot can be reused', async () => {
  const { id } = await H.createWall(s);
  const streams = [];
  try {
    for (let i = 0; i < 50; i += 1) streams.push(await open(id));
    const over = await s.call('GET', `/api/walls/${id}/events`);
    assert.equal(over.status, 503);
    assert.deepEqual(over.body, { error: { code: 'capacity', message: 'The archive is full.' } });
    streams.pop().close();
    const again = await H.waitFor(async () => {
      const es = await H.openEvents(s, id);
      if (es.res.status === 200) return es;
      es.close();
      return null;
    }, 8000, 'a freed subscriber slot');
    streams.push(again);
  } finally { streams.forEach((e) => e.close()); }
});

test('SIGTERM ends open streams and the server exits 0', async () => {
  const own = await H.startServer();
  const { id } = await H.createWall({ call: own.call });
  const es = await H.openEvents(own, id);
  await es.waitEvent((e) => e.event === 'snapshot');
  const info = await own.stop();
  assert.equal(info.code, 0);
  await H.waitFor(() => es.ended, 5000, 'stream to end');
  es.close();
});
