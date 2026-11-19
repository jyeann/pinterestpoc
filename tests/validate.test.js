'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { coords, defaultPos, isId, isPlainObject } = require('../src/validate');
const { fnv1a32 } = require('../src/hash');

const BAD = { ok: false, code: 'bad_coords' };

test('coords: valid, clamp and round', () => {
  assert.deepEqual(coords({ x: 10, y: 20 }), { ok: true, x: 10, y: 20 });
  assert.deepEqual(coords({ x: -5, y: 1000.6 }), { ok: true, x: 0, y: 1000 });
  assert.deepEqual(coords({ x: 1000, y: 0 }), { ok: true, x: 1000, y: 0 });
  assert.deepEqual(coords({ x: 1001, y: -0.4 }), { ok: true, x: 1000, y: 0 });
  assert.deepEqual(coords({ x: 10.4, y: 10.5 }), { ok: true, x: 10, y: 11 });
  assert.ok(Object.is(coords({ x: -0.3, y: 0 }).x, 0));
});

test('coords: absent when neither given or body not an object', () => {
  assert.deepEqual(coords({}), { ok: true, absent: true });
  assert.deepEqual(coords({ phrase: 'p' }), { ok: true, absent: true });
  assert.deepEqual(coords(null), { ok: true, absent: true });
  assert.deepEqual(coords(undefined), { ok: true, absent: true });
});

test('coords: one axis, strings, NaN, null, infinities refused', () => {
  assert.deepEqual(coords({ x: 1 }), BAD);
  assert.deepEqual(coords({ y: 1 }), BAD);
  assert.deepEqual(coords({ x: '1', y: 2 }), BAD);
  assert.deepEqual(coords({ x: 1, y: '2' }), BAD);
  assert.deepEqual(coords({ x: NaN, y: 1 }), BAD);
  assert.deepEqual(coords({ x: 1, y: Infinity }), BAD);
  assert.deepEqual(coords({ x: -Infinity, y: 1 }), BAD);
  assert.deepEqual(coords({ x: null, y: 1 }), BAD);
  assert.deepEqual(coords({ x: 1, y: null }), BAD);
  assert.deepEqual(coords({ x: true, y: false }), BAD);
  assert.deepEqual(coords({ x: [1], y: {} }), BAD);
});

test('defaultPos follows design 2.7 and stays in 100..900', () => {
  const h = fnv1a32('pos:pigeons:3');
  assert.deepEqual(defaultPos('pigeons', 3), { x: 100 + (h % 801), y: 100 + ((h >>> 12) % 801) });
  assert.notDeepEqual(defaultPos('pigeons', 3), defaultPos('pigeons', 4));
  for (let i = 0; i < 500; i++) {
    const p = defaultPos('k' + i, i);
    assert.ok(p.x >= 100 && p.x <= 900 && p.y >= 100 && p.y <= 900);
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
  }
});

test('isId', () => {
  assert.equal(isId('abc_-XYZ09'), true);
  assert.equal(isId('a'), true);
  assert.equal(isId('a'.repeat(32)), true);
  assert.equal(isId('a'.repeat(33)), false);
  assert.equal(isId(''), false);
  assert.equal(isId('a b'), false);
  assert.equal(isId('a/b'), false);
  assert.equal(isId('..'), false);
  assert.equal(isId('a\n'), false);
  assert.equal(isId(5), false);
  assert.equal(isId(null), false);
});

test('isPlainObject', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject(JSON.parse('{"x":1}')), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject('s'), false);
  assert.equal(isPlainObject(3), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject(new Date()), false);
});
