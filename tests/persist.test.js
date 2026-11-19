'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPersist } = require('../src/persist');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rs-persist-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('load: a missing file is null and logs nothing', () => {
  const dir = tmp();
  const logs = [];
  const p = createPersist({ file: path.join(dir, 'd.json'), getData: () => ({}), log: (l) => logs.push(l) });
  assert.equal(p.load(), null);
  assert.deepEqual(logs, []);
  assert.deepEqual(fs.readdirSync(dir), []);
  rm(dir);
});

test('load: a valid file is returned as parsed', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  const data = { format: 1, walls: [{ id: 'a' }] };
  fs.writeFileSync(file, JSON.stringify(data));
  const p = createPersist({ file, getData: () => ({}), log: () => {} });
  assert.deepEqual(p.load(), data);
  assert.deepEqual(fs.readdirSync(dir), ['d.json']);
  rm(dir);
});

test('load: invalid JSON, wrong format, wrong shape and non-objects are renamed to .corrupt-<epochms> with one log line', () => {
  const bodies = ['{"format":1,"walls":[ nope', '', '{"format":2,"walls":[]}', '{"format":1}', '{"format":1,"walls":{}}', '[]', 'null', '5', '"x"', '{"walls":[]}'];
  for (const body of bodies) {
    const dir = tmp();
    const file = path.join(dir, 'd.json');
    fs.writeFileSync(file, body);
    const logs = [];
    const p = createPersist({ file, getData: () => ({}), log: (l) => logs.push(l), nowMs: () => 1234567 });
    assert.equal(p.load(), null, JSON.stringify(body));
    assert.deepEqual(fs.readdirSync(dir), ['d.json.corrupt-1234567'], JSON.stringify(body));
    assert.equal(fs.readFileSync(`${file}.corrupt-1234567`, 'utf8'), body);
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].includes('\n'));
    assert.ok(logs[0].includes('d.json.corrupt-1234567'));
    rm(dir);
  }
});

test('load: a log line never echoes file content', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, '{"title":"SECRET-PHRASE-QQ" nope');
  const logs = [];
  createPersist({ file, getData: () => ({}), log: (l) => logs.push(l) }).load();
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('SECRET-PHRASE-QQ'));
  rm(dir);
});

test('load: a path that cannot be read as a file (a directory) is treated as corrupt, never a crash', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  fs.mkdirSync(file);
  const logs = [];
  const p = createPersist({ file, getData: () => ({}), log: (l) => logs.push(l), nowMs: () => 42 });
  assert.equal(p.load(), null);
  assert.equal(logs.length, 1);
  assert.ok(fs.existsSync(`${file}.corrupt-42`));
  rm(dir);
});

test('scheduleSave debounces: many calls produce one write after the delay', async () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  let calls = 0;
  const p = createPersist({ file, delay: 30, getData: () => { calls += 1; return { format: 1, walls: [], n: calls }; }, log: () => {} });
  assert.equal(p.pending(), false);
  for (let i = 0; i < 20; i += 1) p.scheduleSave();
  assert.equal(p.pending(), true);
  assert.ok(!fs.existsSync(file), 'not written synchronously');
  await waitFor(() => fs.existsSync(file));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 1);
  assert.equal(p.pending(), false);
  assert.deepEqual(fs.readdirSync(dir), ['d.json'], 'no temp file left');
  rm(dir);
});

test('flush writes synchronously, cancels the timer, and is a no-op when nothing is pending', async () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  let calls = 0;
  const p = createPersist({ file, delay: 20, getData: () => { calls += 1; return { format: 1, walls: [{ id: 'x' }] }; }, log: () => {} });
  assert.equal(p.flush(), false);
  assert.equal(calls, 0);
  p.scheduleSave();
  assert.equal(p.flush(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { format: 1, walls: [{ id: 'x' }] });
  assert.equal(p.pending(), false);
  assert.equal(p.flush(), false);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls, 1);
  rm(dir);
});

test('save is atomic: it goes through <file>.tmp-<pid> and renames over the target, replacing old content', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, 'OLD');
  const seen = [];
  const p = createPersist({
    file,
    getData: () => {
      seen.push(fs.readFileSync(file, 'utf8'));
      return { format: 1, walls: [] };
    },
    log: () => {},
  });
  p.scheduleSave();
  p.flush();
  assert.deepEqual(seen, ['OLD'], 'target untouched until the rename');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"format":1,"walls":[]}');
  assert.deepEqual(fs.readdirSync(dir), ['d.json']);
  rm(dir);
});

test('save creates missing parent directories', () => {
  const dir = tmp();
  const file = path.join(dir, 'sub', 'deeper', 'd.json');
  const p = createPersist({ file, getData: () => ({ format: 1, walls: [] }), log: () => {} });
  p.scheduleSave();
  assert.equal(p.flush(), true);
  assert.ok(fs.existsSync(file));
  rm(dir);
});

test('a write error is logged once, leaves no temp file, and does not throw; a later save can succeed', () => {
  const dir = tmp();
  const file = path.join(dir, 'd.json');
  fs.mkdirSync(file); // renaming a file over a directory fails
  const logs = [];
  const p = createPersist({ file, getData: () => ({ format: 1, walls: [] }), log: (l) => logs.push(l) });
  p.scheduleSave();
  assert.equal(p.flush(), false);
  assert.equal(logs.length, 1);
  assert.ok(!logs[0].includes('\n'));
  assert.deepEqual(fs.readdirSync(dir), ['d.json']);
  fs.rmdirSync(file);
  p.scheduleSave();
  assert.equal(p.flush(), true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).format, 1);
  rm(dir);
});
