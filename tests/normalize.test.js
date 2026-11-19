'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhrase, normalizeTitle } = require('../src/normalize');

test('phrase: non-strings are phrase_invalid', () => {
  for (const v of [undefined, null, 5, {}, [], true, false]) {
    assert.deepEqual(normalizePhrase(v), { ok: false, code: 'phrase_invalid' });
  }
});

test('phrase: whitespace collapse, trim, key lowercases, case preserved', () => {
  const r = normalizePhrase('  The\t\nMoon \r\n  Landing ');
  assert.deepEqual(r, { ok: true, value: 'The Moon Landing', key: 'the moon landing' });
  assert.equal(normalizePhrase('  the\t\nmoon ').value, 'the moon');
});

test('phrase: NFC applied', () => {
  const r = normalizePhrase('é');
  assert.equal(r.value, 'é');
  assert.equal([...r.value].length, 1);
});

test('phrase: control and zero-width removal', () => {
  assert.equal(normalizePhrase('\u0007').code, 'phrase_empty');
  assert.equal(normalizePhrase('a\u0007b').value, 'ab');
  assert.equal(normalizePhrase('a\u0085b\u001fc\u007fd').value, 'abcd');
  assert.equal(normalizePhrase('a​b‌c‍d⁠e﻿ f').value, 'abcde f');
  assert.equal(normalizePhrase('​⁠﻿').code, 'phrase_empty');
});

test('phrase: empty and whitespace only', () => {
  assert.equal(normalizePhrase('').code, 'phrase_empty');
  assert.equal(normalizePhrase(' \t\n ').code, 'phrase_empty');
});

test('phrase: 60 code points ok, 61 too long', () => {
  assert.equal(normalizePhrase('a'.repeat(60)).ok, true);
  assert.deepEqual(normalizePhrase('a'.repeat(61)), { ok: false, code: 'phrase_too_long' });
  assert.equal(normalizePhrase('\u{1F600}'.repeat(60)).ok, true);
  assert.equal(normalizePhrase('\u{1F600}'.repeat(61)).code, 'phrase_too_long');
  assert.equal(normalizePhrase('a'.repeat(60) + '  ').ok, true);
});

test('title: codes', () => {
  assert.deepEqual(normalizeTitle('  My  Case '), { ok: true, value: 'My Case', key: 'my case' });
  assert.equal(normalizeTitle(42).code, 'title_empty');
  assert.equal(normalizeTitle(undefined).code, 'title_empty');
  assert.equal(normalizeTitle('  ').code, 'title_empty');
  assert.equal(normalizeTitle('b'.repeat(60)).ok, true);
  assert.equal(normalizeTitle('b'.repeat(61)).code, 'title_too_long');
});
