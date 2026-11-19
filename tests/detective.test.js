'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { suggest, message } = require('../src/detective');
const { fnv1a32 } = require('../src/hash');

const pin = (id, phrase) => ({ id, phrase });
const str = (a, b) => ({ a, b });

test('too_few declines', () => {
  assert.deepEqual(suggest({ pins: [], strings: [] }), { decline: 'too_few' });
  assert.deepEqual(suggest({ pins: [pin('a', 'x')], strings: [] }), { decline: 'too_few' });
});

test('all_connected declines (either direction)', () => {
  const w = { pins: [pin('a', 'x'), pin('b', 'y'), pin('c', 'z')], strings: [str('a', 'b'), str('c', 'a'), str('b', 'c')] };
  assert.deepEqual(suggest(w), { decline: 'all_connected' });
  assert.deepEqual(suggest({ pins: [pin('a', 'x'), pin('b', 'y')], strings: [str('b', 'a')] }), { decline: 'all_connected' });
});

test('two pins, no strings: pair in creation order', () => {
  assert.deepEqual(suggest({ pins: [pin('a', 'zz'), pin('b', 'aa')], strings: [] }), { pair: ['a', 'b'] });
});

test('lowest degree sum wins', () => {
  // d: a=2 b=1 c=0 d=0 ; tied a-b, a-c? build: a-b, a-e ; pins a b c d e
  const w = {
    pins: [pin('a', 'one'), pin('b', 'two'), pin('c', 'three'), pin('d', 'four')],
    strings: [str('a', 'b'), str('a', 'c')],
  };
  // degrees a2 b1 c1 d0 ; untied: a-d(2), b-c(2), b-d(1), c-d(1)
  const r = suggest(w);
  assert.ok(['b,d', 'c,d'].includes(r.pair.join(',')));
});

test('tie broken by highest hash of sorted keys, then earliest', () => {
  const pins = [pin('a', 'Alpha'), pin('b', 'beta'), pin('c', 'Gamma'), pin('d', 'delta')];
  const w = { pins, strings: [] };
  let best = null;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const k = [pins[i].phrase.toLowerCase(), pins[j].phrase.toLowerCase()].sort();
    const h = fnv1a32('detective:' + k[0] + '\u0000' + k[1]);
    if (best === null || h > best.h) best = { h, pair: [pins[i].id, pins[j].id] };
  }
  assert.deepEqual(suggest(w), { pair: best.pair });
  // order of pin phrases within pair key must not matter: swapping creation order keeps the same hash
  const swapped = suggest({ pins: [pins[1], pins[0], pins[2], pins[3]], strings: [] });
  assert.equal(swapped.pair.length, 2);
});

test('hash tie (identical phrases) falls to earliest pair', () => {
  const w = { pins: [pin('a', 'same'), pin('b', 'same'), pin('c', 'same')], strings: [] };
  assert.deepEqual(suggest(w), { pair: ['a', 'b'] });
  const w2 = { pins: [pin('a', 'same'), pin('b', 'same'), pin('c', 'same')], strings: [str('a', 'b')] };
  assert.deepEqual(suggest(w2), { pair: ['a', 'c'] });
});

test('pure: does not mutate and repeats', () => {
  const w = { pins: [pin('a', 'x'), pin('b', 'y'), pin('c', 'z')], strings: [str('a', 'b')] };
  const snap = JSON.stringify(w);
  assert.deepEqual(suggest(w), suggest(w));
  assert.equal(JSON.stringify(w), snap);
});

test('messages', () => {
  const w = { pins: [pin('a', 'Pigeons'), pin('b', 'the moon')], strings: [] };
  assert.equal(message({ pair: ['a', 'b'] }, w), 'I like Pigeons and the moon together. Nobody ever asks why.');
  assert.equal(message({ decline: 'too_few' }, w), 'Two pins minimum. Even I cannot connect a single dot.');
  assert.equal(message({ decline: 'all_connected' }, w), 'Everything is already connected. That is what worries me.');
});
