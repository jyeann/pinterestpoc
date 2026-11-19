'use strict';
// Persistence and lifecycle (design 6): RED_STRING_DATA, atomic save, restart, corrupt files.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers.js');

const freshDir = () => H.tmpDir();
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

async function withFile(fn) {
  const dir = freshDir();
  const file = path.join(dir, 'red-string.json');
  try { return await fn(file, dir); } finally { cleanup(dir); }
}

test('a wall survives a restart: pins, positions, strings, findings, art, score', async () => {
  await withFile(async (file) => {
    let s = await H.startServer({ dataFile: file });
    const { id } = await H.createWall(s, 'Kept Case');
    const a = (await H.addPin(s, id, 'pigeons', [123, 456])).id;
    const b = (await H.addPin(s, id, 'the moon', [700, 80])).id;
    const c = (await H.addPin(s, id, 'ufo')).id;
    await H.tie(s, id, a, b);
    await H.tie(s, id, b, c);
    await s.call('PATCH', `/api/walls/${id}/pins/${c}`, { x: 9, y: 990 });
    const before = (await H.getWall(s, id)).body;
    assert.equal(before.score, H.scoreOf(3, [[0, 1], [1, 2]]));
    s = await H.restart(s, { dataFile: file });
    try {
      const after = await H.getWall(s, id);
      assert.equal(after.status, 200);
      assert.deepEqual(after.body, before);
      // the loaded wall is live: it accepts new edits
      assert.equal((await H.addPin(s, id, 'after restart')).res.status, 201);
    } finally { await s.stop(); }
  });
});

test('the data file is {"format":1,"walls":[...]} after a clean stop, with no temp files left behind', async () => {
  await withFile(async (file, dir) => {
    const s = await H.startServer({ dataFile: file });
    const { id } = await H.createWall(s, 'On Disk');
    await H.addPin(s, id, 'pigeons');
    const info = await s.stop();
    assert.equal(info.code, 0);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.format, 1);
    assert.ok(Array.isArray(saved.walls));
    const w = saved.walls.find((x) => x.id === id);
    assert.ok(w, 'wall saved');
    assert.equal(w.title, 'On Disk');
    assert.equal(w.pins[0].phrase, 'pigeons');
    assert.deepEqual(fs.readdirSync(dir), ['red-string.json']);
  });
});

test('a change made just before SIGTERM is flushed to disk', async () => {
  await withFile(async (file) => {
    let s = await H.startServer({ dataFile: file });
    const { id } = await H.createWall(s);
    const r = await H.addPin(s, id, 'last second');
    assert.equal(r.res.status, 201);
    s = await H.restart(s, { dataFile: file });
    try {
      const g = (await H.getWall(s, id)).body;
      assert.deepEqual(g.pins.map((p) => p.phrase), ['last second']);
    } finally { await s.stop(); }
  });
});

test('edits made after one restart persist through a second', async () => {
  await withFile(async (file) => {
    let s = await H.startServer({ dataFile: file });
    const { id } = await H.createWall(s, 'Round 1');
    await H.addPin(s, id, 'first');
    s = await H.restart(s, { dataFile: file });
    await s.call('PATCH', `/api/walls/${id}`, { title: 'Round 2' });
    await H.addPin(s, id, 'second');
    s = await H.restart(s, { dataFile: file });
    try {
      const g = (await H.getWall(s, id)).body;
      assert.equal(g.title, 'Round 2');
      assert.deepEqual(g.pins.map((p) => p.phrase), ['first', 'second']);
    } finally { await s.stop(); }
  });
});

test('without RED_STRING_DATA nothing is kept across a restart', async () => {
  let s = await H.startServer();
  const { id } = await H.createWall(s);
  s = await H.restart(s);
  try {
    assert.equal((await H.getWall(s, id)).status, 404);
  } finally { await s.stop(); }
});

test('a missing data file starts empty and the server serves', async () => {
  await withFile(async (file) => {
    assert.ok(!fs.existsSync(file));
    const s = await H.startServer({ dataFile: file });
    try {
      assert.equal((await s.call('GET', '/healthz')).status, 200);
      assert.equal((await H.createWall(s)).res.status, 201);
    } finally { await s.stop(); }
  });
});

test('an unreadable data file is renamed to <path>.corrupt-<epochms>, one line is logged, the server starts empty', async () => {
  await withFile(async (file, dir) => {
    const junk = '{"format":1,"walls":[ this is not json';
    fs.writeFileSync(file, junk);
    const s = await H.startServer({ dataFile: file });
    try {
      assert.equal((await s.call('GET', '/healthz')).status, 200);
      assert.equal((await H.createWall(s)).res.status, 201);
    } finally { await s.stop(); }
    const moved = fs.readdirSync(dir).filter((f) => /^red-string\.json\.corrupt-\d+$/.test(f));
    assert.equal(moved.length, 1, fs.readdirSync(dir).join(','));
    assert.equal(fs.readFileSync(path.join(dir, moved[0]), 'utf8'), junk, 'the corrupt file is kept, not overwritten');
    assert.ok(s.logs().stderr.trim().length > 0, 'a line goes to stderr');
    const fresh = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(fresh.format, 1);
  });
});

test('valid JSON with the wrong format is treated as corrupt too', async () => {
  await withFile(async (file, dir) => {
    fs.writeFileSync(file, JSON.stringify({ format: 2, walls: [] }));
    const s = await H.startServer({ dataFile: file });
    try {
      assert.equal((await s.call('GET', '/healthz')).status, 200);
    } finally { await s.stop(); }
    assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.corrupt-')).length, 1);
  });
});

test('on load art and findings are recomputed from the phrases, and invalid walls are skipped', async () => {
  await withFile(async (file) => {
    // expected values come from a live server doing the same work
    const ref = await H.startServer();
    const rw = (await H.createWall(ref)).id;
    const ra = await H.addPin(ref, rw, 'Zebra Alpha');
    const rb = await H.addPin(ref, rw, 'Moon Beta');
    const rt = await H.tie(ref, rw, ra.id, rb.id);
    const expected = { artA: ra.pin.art, artB: rb.pin.art, finding: rt.string.finding };
    await ref.stop();

    const now = new Date().toISOString();
    const wall = {
      id: 'HandMadeWall', title: 'Hand made', createdAt: now, version: 5,
      pins: [
        { id: 'pAAAAAAAA', phrase: 'Zebra Alpha', x: 10, y: 20, art: 'BOGUS-ART', createdAt: now },
        { id: 'pBBBBBBBB', phrase: 'Moon Beta', x: 30, y: 40, art: 'BOGUS-ART', createdAt: now },
      ],
      strings: [{ id: 'sCCCCCCCC', a: 'pAAAAAAAA', b: 'pBBBBBBBB', finding: 'BOGUS-FINDING', createdAt: now }],
    };
    fs.writeFileSync(file, JSON.stringify({ format: 1, walls: [null, 42, 'x', wall] }));
    const s = await H.startServer({ dataFile: file });
    try {
      const g = await H.getWall(s, 'HandMadeWall');
      assert.equal(g.status, 200);
      assert.equal(g.body.title, 'Hand made');
      assert.equal(g.body.pins[0].art, expected.artA);
      assert.equal(g.body.pins[1].art, expected.artB);
      assert.equal(g.body.strings[0].finding, expected.finding);
      assert.equal(g.body.score, 14);
      assert.equal(g.body.status, 'Hunch');
      assert.deepEqual(g.body.pins.map((p) => [p.x, p.y]), [[10, 20], [30, 40]]);
    } finally { await s.stop(); }
  });
});
