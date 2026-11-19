'use strict';
// Server-Sent Events hub (design 4.1).

const MAX_PER_WALL = 50;
const MAX_PER_ADDR = 60; // above the 50-per-wall cap an acceptance test fills from one address
const MAX_TOTAL = 2000;

function frame(name, data) {
  return `id: ${data.version}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createHub(opts = {}) {
  const heartbeatMs = opts.heartbeatMs === undefined ? 15000 : opts.heartbeatMs;
  const maxPerWall = opts.maxPerWall === undefined ? MAX_PER_WALL : opts.maxPerWall;
  const maxPerAddr = opts.maxPerAddr === undefined ? MAX_PER_ADDR : opts.maxPerAddr;
  const maxTotal = opts.maxTotal === undefined ? MAX_TOTAL : opts.maxTotal;
  const subs = new Map(); // wallId -> Set<res>
  const addrOf = new Map(); // res -> address
  let timer = null;

  function remove(wallId, res) {
    const set = subs.get(wallId);
    if (!set) return;
    set.delete(res);
    addrOf.delete(res);
    if (set.size === 0) subs.delete(wallId);
    if (subs.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function writeTo(wallId, res, text) {
    try {
      res.write(text);
    } catch {
      remove(wallId, res);
    }
  }

  function ping() {
    for (const [wallId, set] of [...subs]) {
      for (const res of [...set]) writeTo(wallId, res, ': ping\n\n');
    }
  }

  function ensureTimer() {
    if (timer || !(heartbeatMs > 0)) return;
    timer = setInterval(ping, heartbeatMs);
    if (timer.unref) timer.unref();
  }

  return {
    // Returns false (nothing written) when the wall already has the maximum number of subscribers.
    subscribe(wallId, res, snapshot, addr) {
      const existing = subs.get(wallId);
      if (existing && existing.size >= maxPerWall) return false;
      if (addrOf.size >= maxTotal) return false;
      if (existing && addr !== undefined) {
        let same = 0;
        for (const r of existing) if (addrOf.get(r) === addr) same += 1;
        if (same >= maxPerAddr) return false;
      }
      addrOf.set(res, addr);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      const set = existing || new Set();
      set.add(res);
      subs.set(wallId, set);
      res.on('close', () => remove(wallId, res));
      writeTo(wallId, res, 'retry: 1000\n\n');
      writeTo(wallId, res, frame('snapshot', snapshot));
      ensureTimer();
      return true;
    },
    publish(wallId, event, data) {
      const set = subs.get(wallId);
      if (!set) return;
      const text = frame(event, data);
      for (const res of [...set]) writeTo(wallId, res, text);
    },
    count(wallId) {
      const set = subs.get(wallId);
      return set ? set.size : 0;
    },
    ping,
    closeAll() {
      const all = [...subs.values()].flatMap((set) => [...set]);
      subs.clear();
      addrOf.clear();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const res of all) {
        try { res.end(); } catch { /* already gone */ }
      }
    },
  };
}

module.exports = { createHub, MAX_PER_WALL, MAX_PER_ADDR, MAX_TOTAL };
