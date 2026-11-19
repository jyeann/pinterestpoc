'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore, LIMITS } = require('../src/store');
const { artSvg } = require('../src/art');
const { finding } = require('../src/findings');

const EVENT_LOG = () => {
  const events = [];
  const store = createStore({ onChange: (wallId, name, data) => events.push({ wallId, name, data }) });
  return { store, events };
};
const newWall = (store, title) => store.createWall(title === undefined ? {} : { title }).wall;
const pin = (store, id, phrase, xy) => {
  const r = store.addPin(id, xy ? { phrase, x: xy[0], y: xy[1] } : { phrase });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.pin;
};

test('limits constants match design 3', () => {
  assert.deepEqual(LIMITS, { pins: 100, strings: 500, walls: 10000 });
});

test('createWall: id format, default title, empty wall, meta, unknown fields ignored', () => {
  const { store } = EVENT_LOG();
  const r = store.createWall({});
  assert.equal(r.ok, true);
  assert.match(r.wall.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(r.wall.title, `Case #${r.wall.id}`);
  assert.deepEqual(r.wall.pins, []);
  assert.deepEqual(r.wall.strings, []);
  assert.deepEqual(r.meta, { score: 0, level: 0, status: 'Hunch', version: r.wall.version });
  assert.ok(!Number.isNaN(Date.parse(r.wall.createdAt)));
  assert.equal(store.createWall({ title: '  a\t b ', junk: 1 }).wall.title, 'a b');
  assert.equal(store.createWall().ok, true);
  assert.notEqual(store.createWall({}).wall.id, store.createWall({}).wall.id);
});

test('createWall title errors and the title boundary at 60 code points', () => {
  const { store } = EVENT_LOG();
  assert.deepEqual(store.createWall({ title: '' }), { ok: false, code: 'title_empty' });
  assert.deepEqual(store.createWall({ title: '   ' }), { ok: false, code: 'title_empty' });
  assert.deepEqual(store.createWall({ title: null }), { ok: false, code: 'title_empty' });
  assert.deepEqual(store.createWall({ title: 5 }), { ok: false, code: 'title_empty' });
  assert.equal(store.createWall({ title: 'a'.repeat(60) }).ok, true);
  assert.deepEqual(store.createWall({ title: 'a'.repeat(61) }), { ok: false, code: 'title_too_long' });
});

test('createWall: the 10 001st wall is capacity, the 10 000th is fine, title errors win over capacity', () => {
  const { store } = EVENT_LOG();
  let first;
  for (let i = 0; i < LIMITS.walls; i += 1) {
    const r = store.createWall({});
    assert.equal(r.ok, true, `wall ${i}`);
    if (i === 0) first = r.wall.id;
  }
  assert.deepEqual(store.createWall({}), { ok: false, code: 'capacity' });
  assert.deepEqual(store.createWall({ title: '' }), { ok: false, code: 'title_empty' });
  assert.equal(store.getWall(first).id, first);
  assert.equal(store.addPin(first, { phrase: 'still works' }).ok, true);
});

test('getWall returns a snapshot copy; unknown id is null', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store, 'T');
  pin(store, w.id, 'one');
  const a = store.getWall(w.id);
  a.pins[0].phrase = 'tampered';
  a.title = 'tampered';
  a.pins.length = 0;
  const b = store.getWall(w.id);
  assert.equal(b.pins[0].phrase, 'one');
  assert.equal(b.title, 'T');
  assert.equal(store.getWall('nope'), null);
  assert.equal(store.getWall('constructor'), null);
});

test('setTitle: normalises, bumps version, returns meta; errors leave the wall untouched', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store, 'old');
  const r = store.setTitle(w.id, '  new   title ');
  assert.equal(r.ok, true);
  assert.equal(r.title, 'new title');
  assert.equal(r.meta.version, w.version + 1);
  assert.deepEqual(store.setTitle('nope', 'x'), { ok: false, code: 'not_found' });
  assert.deepEqual(store.setTitle(w.id, ''), { ok: false, code: 'title_empty' });
  assert.deepEqual(store.setTitle(w.id, undefined), { ok: false, code: 'title_empty' });
  assert.deepEqual(store.setTitle(w.id, 'q'.repeat(61)), { ok: false, code: 'title_too_long' });
  assert.deepEqual(store.setTitle('nope', ''), { ok: false, code: 'not_found' });
  const g = store.getWall(w.id);
  assert.equal(g.title, 'new title');
  assert.equal(g.version, w.version + 1);
});

test('addPin: fields, art, normalisation, case kept, increments version', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const r = store.addPin(w.id, { phrase: '  The\tMoon ', x: 10, y: 20 });
  assert.equal(r.ok, true);
  assert.match(r.pin.id, /^p[A-Za-z0-9_-]{8}$/);
  assert.equal(r.pin.phrase, 'The Moon');
  assert.deepEqual([r.pin.x, r.pin.y], [10, 20]);
  assert.equal(r.pin.art, artSvg('The Moon'));
  assert.equal(r.meta.version, w.version + 1);
  assert.equal(store.getWall(w.id).pins.length, 1);
  assert.ok(!Number.isNaN(Date.parse(r.pin.createdAt)));
});

test('addPin default position: 100..900, depends on key and pin count, not on case or wall', () => {
  const { store } = EVENT_LOG();
  const w1 = newWall(store);
  const w2 = newWall(store);
  const a = pin(store, w1.id, 'Pigeons');
  const b = pin(store, w2.id, 'pigeons');
  assert.deepEqual([a.x, a.y], [b.x, b.y]);
  for (const v of [a.x, a.y]) assert.ok(v >= 100 && v <= 900);
  const again = pin(store, w1.id, 'pigeons');
  const expected = require('../src/validate').defaultPos('pigeons', 1);
  assert.deepEqual([again.x, again.y], [expected.x, expected.y]);
});

test('addPin coordinates: clamp, round, both-or-neither, finite numbers only', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const cases = [[[-5, 1000.6], [0, 1000]], [[5000, -80], [1000, 0]], [[2.4, 2.6], [2, 3]], [[0, 1000], [0, 1000]]];
  for (const [input, want] of cases) {
    const p = pin(store, w.id, 'c', input);
    assert.deepEqual([p.x, p.y], want);
  }
  for (const body of [{ phrase: 'p', x: 1 }, { phrase: 'p', y: 1 }, { phrase: 'p', x: '1', y: 1 }, { phrase: 'p', x: 1, y: null }, { phrase: 'p', x: NaN, y: 1 }]) {
    assert.deepEqual(store.addPin(w.id, body), { ok: false, code: 'bad_coords' }, JSON.stringify(body));
  }
});

test('addPin validation order: wall, phrase, coords, wall_full', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  assert.deepEqual(store.addPin('nope', { phrase: '' }), { ok: false, code: 'not_found' });
  assert.equal(store.addPin(w.id, { phrase: '', x: 'a', y: 1 }).code, 'phrase_empty');
  assert.equal(store.addPin(w.id, {}).code, 'phrase_invalid');
  assert.equal(store.addPin(w.id, { phrase: 5 }).code, 'phrase_invalid');
  assert.equal(store.addPin(w.id, { phrase: 'a'.repeat(61) }).code, 'phrase_too_long');
  assert.equal(store.addPin(w.id, { phrase: 'a'.repeat(60) }).ok, true);
  assert.equal(store.addPin(w.id, null).code, 'phrase_invalid');
});

test('addPin: the 100th pin is ok, the 101st is wall_full after phrase and coords checks, delete frees a slot', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const ids = [];
  for (let i = 0; i < 100; i += 1) ids.push(pin(store, w.id, `p ${i}`).id);
  assert.deepEqual(store.addPin(w.id, { phrase: 'extra' }), { ok: false, code: 'wall_full' });
  assert.equal(store.addPin(w.id, { phrase: '' }).code, 'phrase_empty');
  assert.equal(store.addPin(w.id, { phrase: 'x', x: 1 }).code, 'bad_coords');
  assert.equal(store.getWall(w.id).pins.length, 100);
  store.removePin(w.id, ids[0]);
  assert.equal(store.addPin(w.id, { phrase: 'extra' }).ok, true);
});

test('duplicate phrases are allowed and get different ids', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  assert.notEqual(pin(store, w.id, 'twin').id, pin(store, w.id, 'twin').id);
});

test('movePin: clamps, rounds, keeps other fields, bumps version; errors', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const p = pin(store, w.id, 'mover', [1, 2]);
  const r = store.movePin(w.id, p.id, { x: 400.4, y: -3 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.pin, { ...p, x: 400, y: 0 });
  assert.equal(r.meta.version, store.getWall(w.id).version);
  assert.equal(store.movePin(w.id, p.id, { x: 5000, y: 1000.4 }).pin.x, 1000);
  assert.deepEqual(store.movePin(w.id, p.id, { x: 'a', y: 1 }), { ok: false, code: 'bad_coords' });
  assert.deepEqual(store.movePin(w.id, p.id, { x: 1 }), { ok: false, code: 'bad_coords' });
  assert.deepEqual(store.movePin(w.id, p.id, {}), { ok: false, code: 'bad_coords' });
  assert.deepEqual(store.movePin(w.id, 'pmissing', { x: 1, y: 1 }), { ok: false, code: 'not_found' });
  assert.deepEqual(store.movePin('nope', p.id, { x: 1, y: 1 }), { ok: false, code: 'not_found' });
  const other = newWall(store);
  assert.deepEqual(store.movePin(other.id, p.id, { x: 1, y: 1 }), { ok: false, code: 'not_found' });
});

test('addString: finding from the pin phrases, a/b as given, meta score 14', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const a = pin(store, w.id, 'Pigeons');
  const b = pin(store, w.id, 'the moon');
  const r = store.addString(w.id, b.id, a.id);
  assert.equal(r.ok, true);
  assert.match(r.string.id, /^s[A-Za-z0-9_-]{8}$/);
  assert.equal(r.string.a, b.id);
  assert.equal(r.string.b, a.id);
  assert.equal(r.string.finding, finding('Pigeons', 'the moon'));
  assert.equal(r.meta.score, 14);
  assert.equal(r.meta.status, 'Hunch');
  assert.deepEqual(store.getWall(w.id).strings, [r.string]);
});

test('addString validation order: wall, self_link, bad_pin, duplicate, strings_full', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const other = newWall(store);
  const a = pin(store, w.id, 'a');
  const b = pin(store, w.id, 'b');
  const foreign = pin(store, other.id, 'f');
  assert.deepEqual(store.addString('nope', 'x', 'x'), { ok: false, code: 'not_found' });
  assert.deepEqual(store.addString(w.id, a.id, a.id), { ok: false, code: 'self_link' });
  assert.deepEqual(store.addString(w.id, 'pghost', 'pghost'), { ok: false, code: 'self_link' });
  for (const [x, y] of [[a.id, 'pghost'], ['pghost', a.id], [a.id, undefined], [undefined, a.id], [undefined, undefined], [a.id, foreign.id], [5, 5 + 1], [a.id, 7], [null, null]]) {
    assert.deepEqual(store.addString(w.id, x, y), { ok: false, code: 'bad_pin' }, `${x} ${y}`);
  }
  assert.equal(store.addString(w.id, a.id, b.id).ok, true);
  assert.deepEqual(store.addString(w.id, a.id, b.id), { ok: false, code: 'duplicate_string' });
  assert.deepEqual(store.addString(w.id, b.id, a.id), { ok: false, code: 'duplicate_string' });
  assert.equal(store.getWall(w.id).strings.length, 1);
});

test('addString: the 500th string is ok, the 501st is strings_full, a duplicate is still duplicate_string, cutting makes room', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const ids = [];
  for (let i = 0; i < 40; i += 1) ids.push(pin(store, w.id, `n ${i}`).id);
  const pairs = [];
  for (let i = 0; i < 40; i += 1) for (let j = i + 1; j < 40; j += 1) pairs.push([ids[i], ids[j]]);
  for (let i = 0; i < 500; i += 1) assert.equal(store.addString(w.id, ...pairs[i]).ok, true, `string ${i}`);
  assert.deepEqual(store.addString(w.id, ...pairs[500]), { ok: false, code: 'strings_full' });
  assert.equal(store.addString(w.id, pairs[0][1], pairs[0][0]).code, 'duplicate_string');
  const first = store.getWall(w.id).strings[0];
  assert.equal(store.removeString(w.id, first.id).ok, true);
  assert.equal(store.addString(w.id, ...pairs[500]).ok, true);
});

test('removeString: meta lowers the score; unknown, repeated and foreign ids are not_found; the pair can be re-tied', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const other = newWall(store);
  const a = pin(store, w.id, 'a');
  const b = pin(store, w.id, 'b');
  const s = store.addString(w.id, a.id, b.id).string;
  assert.deepEqual(store.removeString(other.id, s.id), { ok: false, code: 'not_found' });
  const r = store.removeString(w.id, s.id);
  assert.equal(r.ok, true);
  assert.equal(r.id, s.id);
  assert.equal(r.meta.score, 0);
  assert.deepEqual(store.removeString(w.id, s.id), { ok: false, code: 'not_found' });
  assert.deepEqual(store.removeString('nope', s.id), { ok: false, code: 'not_found' });
  assert.equal(store.addString(w.id, a.id, b.id).ok, true);
});

test('removePin cascades its strings, reports them in order, keeps the others; repeat is not_found', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store);
  const [a, b, c] = ['a', 'b', 'c'].map((p) => pin(store, w.id, p));
  const s1 = store.addString(w.id, a.id, b.id).string;
  const s2 = store.addString(w.id, c.id, a.id).string;
  const s3 = store.addString(w.id, b.id, c.id).string;
  const r = store.removePin(w.id, a.id);
  assert.equal(r.ok, true);
  assert.equal(r.id, a.id);
  assert.deepEqual(r.removedStrings, [s1.id, s2.id]);
  assert.equal(r.meta.score, 14);
  const g = store.getWall(w.id);
  assert.deepEqual(g.pins.map((p) => p.id), [b.id, c.id]);
  assert.deepEqual(g.strings.map((s) => s.id), [s3.id]);
  assert.deepEqual(store.removePin(w.id, a.id), { ok: false, code: 'not_found' });
  assert.deepEqual(store.removePin('nope', a.id), { ok: false, code: 'not_found' });
  assert.deepEqual(store.removePin(w.id, c.id).removedStrings, [s3.id]);
  assert.deepEqual(store.removePin(w.id, b.id).removedStrings, []);
});

test('detective: declines, suggestion in creation order, does not mutate or emit', () => {
  const { store, events } = EVENT_LOG();
  const w = newWall(store);
  const none = store.detective(w.id);
  assert.deepEqual(none, { ok: true, suggestion: null, reason: 'too_few', message: 'Two pins minimum. Even I cannot connect a single dot.' });
  const a = pin(store, w.id, 'Pigeons');
  const b = pin(store, w.id, 'the moon');
  const before = store.getWall(w.id);
  const n = events.length;
  const r = store.detective(w.id);
  assert.deepEqual(r.suggestion, { a: a.id, b: b.id, message: 'I like Pigeons and the moon together. Nobody ever asks why.' });
  assert.equal(r.reason, undefined);
  assert.deepEqual(store.getWall(w.id), before);
  assert.equal(events.length, n);
  store.addString(w.id, a.id, b.id);
  assert.deepEqual(store.detective(w.id), { ok: true, suggestion: null, reason: 'all_connected', message: 'Everything is already connected. That is what worries me.' });
  assert.deepEqual(store.detective('nope'), { ok: false, code: 'not_found' });
});

test('onChange fires synchronously after commit with event names and payloads without by', () => {
  const { store, events } = EVENT_LOG();
  const w = newWall(store);
  events.length = 0;
  const p1 = pin(store, w.id, 'one');
  const p2 = pin(store, w.id, 'two');
  const s = store.addString(w.id, p1.id, p2.id).string;
  store.movePin(w.id, p1.id, { x: 9, y: 8 });
  store.setTitle(w.id, 'Renamed');
  store.removeString(w.id, s.id);
  store.removePin(w.id, p1.id);
  assert.deepEqual(events.map((e) => e.name), ['pin-added', 'pin-added', 'string-added', 'pin-moved', 'title', 'string-removed', 'pin-removed']);
  assert.ok(events.every((e) => e.wallId === w.id && !('by' in e.data)));
  assert.deepEqual(events[0].data.pin, p1);
  assert.equal(events[2].data.score, 14);
  assert.equal(events[2].data.status, 'Hunch');
  assert.deepEqual(events[3].data, { id: p1.id, x: 9, y: 8, score: 14, level: 0, status: 'Hunch', version: events[3].data.version });
  assert.equal(events[4].data.title, 'Renamed');
  assert.equal(events[5].data.id, s.id);
  assert.equal(events[5].data.score, 0);
  assert.deepEqual(events[6].data.removedStrings, []);
  assert.equal(events[6].data.phrase, 'one');
  const versions = events.map((e) => e.data.version);
  assert.deepEqual(versions, [1, 2, 3, 4, 5, 6, 7]);
  const g = store.getWall(w.id);
  assert.equal(g.version, 7);
});

test('failed operations emit nothing and keep the version', () => {
  const { store, events } = EVENT_LOG();
  const w = newWall(store);
  const a = pin(store, w.id, 'a');
  const n = events.length;
  const v = store.getWall(w.id).version;
  store.addPin(w.id, { phrase: '' });
  store.addString(w.id, a.id, a.id);
  store.movePin(w.id, a.id, {});
  store.removePin(w.id, 'pnone');
  store.setTitle(w.id, '');
  assert.equal(events.length, n);
  assert.equal(store.getWall(w.id).version, v);
});

test('subscribe adds listeners; a throwing listener does not undo or fail the mutation', () => {
  const store = createStore();
  const seen = [];
  store.subscribe(() => { throw new Error('bad listener'); });
  store.subscribe((id, name) => seen.push(name));
  const w = store.createWall({}).wall;
  const r = store.addPin(w.id, { phrase: 'x' });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ['wall-created', 'pin-added']);
  assert.equal(store.getWall(w.id).pins.length, 1);
});

test('toJSON/load round trip reproduces walls exactly', () => {
  const { store } = EVENT_LOG();
  const w = newWall(store, 'Kept');
  const a = pin(store, w.id, 'Pigeons', [5, 6]);
  const b = pin(store, w.id, 'the moon');
  store.addString(w.id, a.id, b.id);
  newWall(store);
  const data = JSON.parse(JSON.stringify(store.toJSON()));
  assert.equal(data.format, 1);
  assert.equal(data.walls.length, 2);
  const copy = createStore();
  assert.equal(copy.load(data), 2);
  assert.deepEqual(copy.getWall(w.id), store.getWall(w.id));
  assert.deepEqual(copy.toJSON(), store.toJSON());
  assert.equal(copy.addPin(w.id, { phrase: 'after load' }).ok, true);
});

test('load recomputes art and findings from phrases and skips invalid walls, pins and strings', () => {
  const now = new Date().toISOString();
  const good = {
    id: 'GoodWall', title: 'Hand made', createdAt: now, version: 5,
    pins: [
      { id: 'pA', phrase: 'Zebra Alpha', x: 10, y: 20, art: 'BOGUS', createdAt: now },
      { id: 'pB', phrase: 'Moon Beta', x: 30.4, y: 4000, art: 'BOGUS', createdAt: now },
      { id: 'pA', phrase: 'dup id', x: 1, y: 1 },
      { id: 'bad id', phrase: 'x', x: 1, y: 1 },
      { id: 'pC', phrase: '   ', x: 1, y: 1 },
      { id: 'pD', phrase: 'no coords' },
      { id: 'pE', phrase: 'bad coords', x: 'a', y: 1 },
      null, 7, 'x',
    ],
    strings: [
      { id: 'sAB', a: 'pA', b: 'pB', finding: 'BOGUS', createdAt: now },
      { id: 'sBA', a: 'pB', b: 'pA', finding: 'dup pair' },
      { id: 'sSelf', a: 'pA', b: 'pA' },
      { id: 'sGhost', a: 'pA', b: 'pZ' },
      { id: 'sAB', a: 'pA', b: 'pB' },
      { id: 'bad id', a: 'pA', b: 'pB' },
      null, 5,
    ],
  };
  const store = createStore();
  const count = store.load({ format: 1, walls: [null, 42, 'x', [], { id: 'bad id' }, { title: 'no id' }, good, { ...good }] });
  assert.equal(count, 1);
  const g = store.getWall('GoodWall');
  assert.equal(g.title, 'Hand made');
  assert.equal(g.version, 5);
  assert.deepEqual(g.pins.map((p) => [p.id, p.x, p.y]), [['pA', 10, 20], ['pB', 30, 1000]]);
  assert.equal(g.pins[0].art, artSvg('Zebra Alpha'));
  assert.equal(g.pins[1].art, artSvg('Moon Beta'));
  assert.equal(g.strings.length, 1);
  assert.equal(g.strings[0].finding, finding('Zebra Alpha', 'Moon Beta'));
  assert.equal(g.score, 14);
});

test('load tolerates bad titles, versions and missing arrays, replaces prior contents, and ignores non-objects', () => {
  const store = createStore();
  store.createWall({});
  assert.equal(store.load({ format: 1, walls: [{ id: 'W1', title: 5, version: -2 }, { id: 'W2', title: 'ok', version: 2.5, pins: 'x', strings: {} }] }), 2);
  const w1 = store.getWall('W1');
  assert.equal(w1.title, 'Case #W1');
  assert.equal(w1.version, 0);
  assert.deepEqual(w1.pins, []);
  assert.equal(store.getWall('W2').version, 0);
  assert.ok(!Number.isNaN(Date.parse(w1.createdAt)));
  assert.equal(store.toJSON().walls.length, 2);
  assert.equal(store.load(null), 0);
  assert.equal(store.load({ walls: 'x' }), 0);
  assert.equal(store.toJSON().walls.length, 0);
});

test('load enforces the pin and string limits', () => {
  const pins = [];
  for (let i = 0; i < 105; i += 1) pins.push({ id: `p${i}`, phrase: `ph ${i}`, x: 1, y: 1 });
  const strings = [];
  for (let i = 0; i < 100; i += 1) for (let j = i + 1; j < 100 && strings.length < 505; j += 1) strings.push({ id: `s${strings.length}`, a: `p${i}`, b: `p${j}` });
  const store = createStore();
  store.load({ format: 1, walls: [{ id: 'Big', pins, strings }] });
  const g = store.getWall('Big');
  assert.equal(g.pins.length, 100);
  assert.equal(g.strings.length, 500);
});

test('load: createdAt accepted only as a date string of at most 40 chars', () => {
  const store = createStore({ now: () => 'NOW' });
  const rec = (id, createdAt) => ({ id, title: 't', createdAt, version: 0, pins: [], strings: [] });
  const ok = '2024-01-02T03:04:05.000Z';
  const long40 = `Jan 2 2024 03:04:05 GMT+0000 (${'x'.repeat(9)})`;
  store.load({ walls: [rec('a', ok), rec('b', 'garbage'), rec('c', 5), rec('d', long40), rec('e', long40.replace('xxx', 'xxxx')), rec('f', '')] });
  const at = (id) => store.getWall(id).createdAt;
  assert.equal(at('a'), ok);
  assert.equal(at('b'), 'NOW');
  assert.equal(at('c'), 'NOW');
  assert.equal(at('d'), long40);
  assert.equal(at('e'), 'NOW');
  assert.equal(at('f'), 'NOW');
});

test('load: duplicates dropped via indexes; strings reversed pair, repeated id, and ids freed after removal', () => {
  const store = createStore();
  const P = (id, phrase) => ({ id, phrase, x: 1, y: 1 });
  store.load({ walls: [{ id: 'w', pins: [P('p1', 'A'), P('p1', 'B'), P('p2', 'C'), P('p3', 'D')],
    strings: [{ id: 's1', a: 'p1', b: 'p2' }, { id: 's1', a: 'p1', b: 'p3' }, { id: 's2', a: 'p2', b: 'p1' }, { id: 's3', a: 'p1', b: 'p1' }, { id: 's4', a: 'p3', b: 'p1' }] }] });
  const w = store.getWall('w');
  assert.deepEqual(w.pins.map((p) => p.phrase), ['A', 'C', 'D']);
  assert.deepEqual(w.strings.map((s) => s.id), ['s1', 's4']);
  assert.equal(store.addString('w', 'p2', 'p1').code, 'duplicate_string');
  assert.equal(store.addString('w', 'p1', 'p3').code, 'duplicate_string');
  assert.equal(store.addString('w', 'p3', 'p2').ok, true);
  store.removeString('w', 's4');
  assert.equal(store.addString('w', 'p3', 'p1').ok, true);
  store.removePin('w', 'p2');
  assert.equal(store.addString('w', 'p3', 'p2').code, 'bad_pin');
  assert.equal(store.addPin('w', { phrase: 'E' }).ok, true);
});
