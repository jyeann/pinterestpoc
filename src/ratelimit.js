'use strict';
// Token bucket per key (design 5): capacity 120, refill 30/s, idle buckets dropped after 60 s.

function createRateLimiter(opts = {}) {
  const capacity = opts.capacity === undefined ? 120 : opts.capacity;
  const refillPerSec = opts.refillPerSec === undefined ? 30 : opts.refillPerSec;
  const idleMs = opts.idleMs === undefined ? 60000 : opts.idleMs;
  const maxBuckets = opts.maxBuckets === undefined ? 10000 : opts.maxBuckets;
  const now = opts.now || Date.now;
  const buckets = new Map();
  let lastSweep = now();

  function sweep() {
    const t = now();
    for (const [key, b] of buckets) {
      if (t - b.last > idleMs) buckets.delete(key);
    }
    lastSweep = t;
  }

  return {
    // true when the request may proceed
    take(key) {
      const t = now();
      if (t - lastSweep >= idleMs) sweep();
      let b = buckets.get(key);
      if (!b) {
        if (buckets.size >= maxBuckets) {
          sweep();
          if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value); // oldest inserted
        }
        b = { tokens: capacity, last: t };
        buckets.set(key, b);
      } else {
        const elapsed = Math.max(0, t - b.last) / 1000;
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
        b.last = t;
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return true;
      }
      return false;
    },
    sweep,
    size() { return buckets.size; },
  };
}

module.exports = { createRateLimiter };
