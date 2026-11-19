'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../src/ratelimit');

function clock(start = 1000000) {
  const c = { t: start, now: () => c.t, advance(ms) { c.t += ms; } };
  return c;
}

test('allows exactly 120 requests in a burst, then refuses', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  for (let i = 0; i < 120; i += 1) assert.equal(rl.take('a'), true, `request ${i}`);
  assert.equal(rl.take('a'), false);
  assert.equal(rl.take('a'), false);
});

test('buckets are per key', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now, capacity: 2 });
  assert.equal(rl.take('a'), true);
  assert.equal(rl.take('a'), true);
  assert.equal(rl.take('a'), false);
  assert.equal(rl.take('b'), true);
});

test('refills 30 tokens per second, one token after 1/30 s, never above capacity', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  for (let i = 0; i < 120; i += 1) rl.take('a');
  assert.equal(rl.take('a'), false);
  c.advance(33); // 0.99 token
  assert.equal(rl.take('a'), false);
  c.advance(1); // 1.02 tokens
  assert.equal(rl.take('a'), true);
  assert.equal(rl.take('a'), false);
  c.advance(1000); // 30 tokens
  let ok = 0;
  while (rl.take('a')) ok += 1;
  assert.equal(ok, 30);
  c.advance(60000); // would be 1800 tokens, capped at 120
  ok = 0;
  while (rl.take('a')) ok += 1;
  assert.equal(ok, 120);
});

test('a clock that goes backwards does not mint tokens', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now, capacity: 1 });
  assert.equal(rl.take('a'), true);
  c.advance(-5000);
  assert.equal(rl.take('a'), false);
});

test('buckets idle for more than 60 s are dropped, buckets at exactly 60 s are kept', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  rl.take('old');
  c.advance(30000);
  rl.take('mid');
  assert.equal(rl.size(), 2);
  c.advance(30000); // old idle exactly 60000
  rl.sweep();
  assert.equal(rl.size(), 2);
  c.advance(1); // old idle 60001
  rl.sweep();
  assert.equal(rl.size(), 1);
  c.advance(120000);
  rl.sweep();
  assert.equal(rl.size(), 0);
});

test('take sweeps idle buckets on its own', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  rl.take('x');
  rl.take('y');
  c.advance(61000);
  rl.take('z');
  assert.equal(rl.size(), 1);
});

test('bucket cap: at the limit nothing is evicted, one over evicts exactly the oldest', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now, maxBuckets: 3, idleMs: 1000000 });
  for (let i = 0; i < 120; i += 1) rl.take('a');
  rl.take('b'); rl.take('c');
  assert.equal(rl.size(), 3);
  rl.take('b'); // existing key at the cap: no eviction
  assert.equal(rl.size(), 3);
  assert.equal(rl.take('a'), false); // a still present and drained
  rl.take('d');
  assert.equal(rl.size(), 3);
  assert.equal(rl.take('b'), true);
  assert.equal(rl.take('a'), true); // a was evicted, fresh bucket
});

test('bucket cap: evicting the oldest gives that key a fresh bucket', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now, maxBuckets: 2 });
  for (let i = 0; i < 120; i += 1) rl.take('a');
  assert.equal(rl.take('a'), false);
  rl.take('b');
  rl.take('c'); // evicts a
  assert.equal(rl.size(), 2);
  assert.equal(rl.take('a'), true); // fresh bucket
});

test('bucket cap: a full table is swept before evicting', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now, maxBuckets: 2, idleMs: 1000 });
  for (let i = 0; i < 120; i += 1) rl.take('a');
  rl.take('b');
  c.advance(500);
  rl.take('b'); // b stays fresh
  c.advance(600); // a idle 1100 > 1000, b idle 600
  rl.take('c'); // full: sweep drops a only; b kept
  assert.equal(rl.size(), 2);
  assert.equal(rl.take('a'), true); // a recreated by evicting oldest (b)... size stays 2
  assert.equal(rl.size(), 2);
});

test('default bucket cap is 10000', () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  for (let i = 0; i < 10000; i += 1) rl.take(`k${i}`);
  assert.equal(rl.size(), 10000);
  rl.take('over');
  assert.equal(rl.size(), 10000);
});
