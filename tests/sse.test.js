'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHub, MAX_PER_WALL } = require('../src/sse');

function fakeRes() {
  const res = new EventEmitter();
  res.writes = [];
  res.ended = false;
  res.head = null;
  res.writeHead = (s, h) => { res.head = { s, h }; };
  res.write = (t) => { res.writes.push(t); return true; };
  res.end = () => { res.ended = true; };
  return res;
}
const snap = (v = 3) => ({ id: 'w', title: 't', version: v, pins: [], strings: [], score: 0, level: 0, status: 'Hunch' });

test('subscribe writes SSE headers, retry, then the snapshot with id = version', () => {
  const hub = createHub({ heartbeatMs: 0 });
  const res = fakeRes();
  assert.equal(hub.subscribe('w', res, snap(7)), true);
  assert.equal(res.head.s, 200);
  assert.equal(res.head.h['Content-Type'], 'text/event-stream');
  assert.equal(res.head.h['Cache-Control'], 'no-store');
  assert.equal(res.head.h['X-Accel-Buffering'], 'no');
  assert.equal(res.writes[0], 'retry: 1000\n\n');
  assert.equal(res.writes[1], `id: 7\nevent: snapshot\ndata: ${JSON.stringify(snap(7))}\n\n`);
  assert.equal(hub.count('w'), 1);
});

test('publish frames id, event and one-line data to subscribers of that wall only', () => {
  const hub = createHub({ heartbeatMs: 0 });
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe('w1', a, snap());
  hub.subscribe('w2', b, snap());
  hub.publish('w1', 'pin-added', { pin: { phrase: 'multi\nline' }, by: null, version: 9 });
  const frame = a.writes[a.writes.length - 1];
  assert.equal(frame, 'id: 9\nevent: pin-added\ndata: {"pin":{"phrase":"multi\\nline"},"by":null,"version":9}\n\n');
  assert.equal(frame.split('\n').filter((l) => l.startsWith('data:')).length, 1);
  assert.equal(b.writes.length, 2);
  hub.publish('nobody', 'title', { version: 1 });
});

test('close removes the subscriber and later publishes skip it', () => {
  const hub = createHub({ heartbeatMs: 0 });
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe('w', a, snap());
  hub.subscribe('w', b, snap());
  assert.equal(hub.count('w'), 2);
  a.emit('close');
  assert.equal(hub.count('w'), 1);
  const before = a.writes.length;
  hub.publish('w', 'title', { title: 'x', version: 4 });
  assert.equal(a.writes.length, before);
  assert.equal(b.writes.length, 3);
  b.emit('close');
  assert.equal(hub.count('w'), 0);
  assert.equal(hub.count('unknown'), 0);
});

test('the 51st subscriber on a wall is refused and writes nothing; other walls are unaffected; a freed slot is reusable', () => {
  assert.equal(MAX_PER_WALL, 50);
  const hub = createHub({ heartbeatMs: 0 });
  const all = [];
  for (let i = 0; i < 50; i += 1) {
    const r = fakeRes();
    assert.equal(hub.subscribe('w', r, snap()), true, `sub ${i}`);
    all.push(r);
  }
  const over = fakeRes();
  assert.equal(hub.subscribe('w', over, snap()), false);
  assert.equal(over.head, null);
  assert.deepEqual(over.writes, []);
  assert.equal(hub.count('w'), 50);
  assert.equal(hub.subscribe('other', fakeRes(), snap()), true);
  all[0].emit('close');
  assert.equal(hub.subscribe('w', fakeRes(), snap()), true);
  assert.equal(hub.count('w'), 50);
});

test('ping writes a comment heartbeat to every subscriber; the timer fires it too', async () => {
  const hub = createHub({ heartbeatMs: 5 });
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe('w1', a, snap());
  hub.subscribe('w2', b, snap());
  hub.ping();
  assert.equal(a.writes[a.writes.length - 1], ': ping\n\n');
  assert.equal(b.writes[b.writes.length - 1], ': ping\n\n');
  const start = a.writes.length;
  const end = Date.now() + 5000;
  while (a.writes.length < start + 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  assert.ok(a.writes.length >= start + 2, 'interval heartbeat fired');
  hub.closeAll();
});

test('closeAll ends every stream, clears counts, and later publishes are no-ops', () => {
  const hub = createHub({ heartbeatMs: 0 });
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe('w1', a, snap());
  hub.subscribe('w2', b, snap());
  hub.closeAll();
  assert.equal(a.ended, true);
  assert.equal(b.ended, true);
  assert.equal(hub.count('w1'), 0);
  const n = a.writes.length;
  hub.publish('w1', 'title', { version: 1 });
  assert.equal(a.writes.length, n);
  hub.closeAll();
});

test('a subscriber whose write throws is dropped without breaking the others', () => {
  const hub = createHub({ heartbeatMs: 0 });
  const bad = fakeRes();
  const good = fakeRes();
  hub.subscribe('w', bad, snap());
  hub.subscribe('w', good, snap());
  bad.write = () => { throw new Error('socket gone'); };
  hub.publish('w', 'title', { title: 'x', version: 2 });
  assert.equal(hub.count('w'), 1);
  assert.equal(good.writes.length, 3);
  bad.end = () => { throw new Error('gone'); };
  hub.closeAll();
});

test('per-address cap per wall: at the limit ok, one over refused, other address and other wall unaffected', () => {
  const hub = createHub({ heartbeatMs: 0, maxPerAddr: 2 });
  assert.equal(hub.subscribe('w', fakeRes(), snap(), '1.1.1.1'), true);
  assert.equal(hub.subscribe('w', fakeRes(), snap(), '1.1.1.1'), true);
  const over = fakeRes();
  assert.equal(hub.subscribe('w', over, snap(), '1.1.1.1'), false);
  assert.equal(over.head, null);
  assert.equal(hub.subscribe('w', fakeRes(), snap(), '2.2.2.2'), true);
  assert.equal(hub.subscribe('v', fakeRes(), snap(), '1.1.1.1'), true);
  assert.equal(hub.count('w'), 3);
});

test('per-address slot is freed on close', () => {
  const hub = createHub({ heartbeatMs: 0, maxPerAddr: 1 });
  const a = fakeRes();
  assert.equal(hub.subscribe('w', a, snap(), 'x'), true);
  assert.equal(hub.subscribe('w', fakeRes(), snap(), 'x'), false);
  a.emit('close');
  assert.equal(hub.subscribe('w', fakeRes(), snap(), 'x'), true);
});

test('global cap: at the limit ok, one over refused, freed on close and on closeAll', () => {
  const hub = createHub({ heartbeatMs: 0, maxTotal: 2 });
  const a = fakeRes();
  assert.equal(hub.subscribe('a', a, snap(), 'x'), true);
  assert.equal(hub.subscribe('b', fakeRes(), snap(), 'y'), true);
  assert.equal(hub.subscribe('c', fakeRes(), snap(), 'z'), false);
  a.emit('close');
  assert.equal(hub.subscribe('c', fakeRes(), snap(), 'z'), true);
  hub.closeAll();
  assert.equal(hub.subscribe('d', fakeRes(), snap(), 'x'), true);
  assert.equal(hub.subscribe('d', fakeRes(), snap(), 'x'), true);
  assert.equal(hub.subscribe('d', fakeRes(), snap(), 'x'), false);
});

test('defaults: 50 per wall, per-address above 50, 2000 global', () => {
  const { MAX_PER_ADDR, MAX_TOTAL } = require('../src/sse');
  assert.equal(MAX_PER_WALL, 50);
  assert.equal(MAX_PER_ADDR > 50, true);
  assert.equal(MAX_TOTAL, 2000);
});
