'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fnv1a32, mulberry32 } = require('../src/hash');

test('fnv1a32 vectors', () => {
  assert.equal(fnv1a32(''), 2166136261);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
});

test('fnv1a32 hashes UTF-8 bytes and returns uint32', () => {
  assert.equal(fnv1a32('é'), 513665217);
  assert.notEqual(fnv1a32('é'), fnv1a32('e'));
  const h = fnv1a32('some longer string \u{1F600}');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('mulberry32 known values and determinism', () => {
  const r = mulberry32(1);
  assert.equal(r(), 0.6270739405881613);
  assert.equal(r(), 0.002735721180215478);
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('mulberry32 range [0,1)', () => {
  const r = mulberry32(fnv1a32('range'));
  for (let i = 0; i < 2000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1);
  }
});
