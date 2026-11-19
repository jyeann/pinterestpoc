'use strict';
// Hidden tests: the same rules as the visible acceptance tests, on different inputs and edge cases.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Resolved from the working directory so the gate grades the trial's own copy (mutation run included).
const H = require(path.join(process.cwd(), 'acceptance', 'helpers.js'));

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const pinOf = async (wall, phrase, xy) => H.addPin(s, wall, phrase, xy);

test('design 2.1: ZWJ emoji families lose their joiners and count 3 code points each; CJK counts per code point', async () => {
  const { id } = await H.createWall(s);
  const fam = '\u{1F468}‍\u{1F469}‍\u{1F467}';
  const ok = await pinOf(id, fam.repeat(20));
  assert.equal(ok.res.status, 201);
  assert.equal(ok.pin.phrase, '\u{1F468}\u{1F469}\u{1F467}'.repeat(20)); // 60 code points after removing U+200D
  const over = await pinOf(id, fam.repeat(21)); // 63 code points
  assert.equal(over.res.status, 400);
  assert.equal(over.res.body.error.code, 'phrase_too_long');
  const cjk = await pinOf(id, '日本語'.repeat(20));
  assert.equal(cjk.res.status, 201);
  assert.equal((await pinOf(id, '日本語'.repeat(20) + '!')).res.body.error.code, 'phrase_too_long');
});

test('design 2.1: control characters are removed before whitespace collapse and before the empty check', async () => {
  const { id } = await H.createWall(s);
  const table = [
    ['\u0000\u0001\u0002ghost\u001f', 'ghost'],
    ['x\u009f y', 'x y'],
    ['  café\t\tüber  \n', 'café über'],
    ['a  b', 'a b'],
    ['\u{1F680}﻿​\u{1F680}', '\u{1F680}\u{1F680}'],
    ['ñ', 'ñ'],
    ['ALL CAPS stays', 'ALL CAPS stays'],
  ];
  for (const [raw, want] of table) {
    const r = await pinOf(id, raw);
    assert.equal(r.res.status, 201, JSON.stringify(raw));
    assert.equal(r.pin.phrase, want, JSON.stringify(raw));
  }
  for (const raw of ['\u0000', ' 　', '‍⁠', '\u0008\u0009\u000a']) {
    const r = await pinOf(id, raw);
    assert.equal(r.res.status, 400, JSON.stringify(raw));
    assert.equal(r.res.body.error.code, 'phrase_empty', JSON.stringify(raw));
  }
});

test('design 2.4: finding is symmetric on pairs the visible tests never use, across three walls', async () => {
  const pairs = [['Quokka', 'tax audit'], ['Ümlaut', 'zebra'], ['lighthouse', 'LIGHTHOUSE KEEPER'], ['7', 'seven']];
  for (const [x, y] of pairs) {
    const found = [];
    for (const order of [[x, y], [y, x], [x, y]]) {
      const w = (await H.createWall(s)).id;
      const a = (await pinOf(w, order[0])).id;
      const b = (await pinOf(w, order[1])).id;
      const t = await H.tie(s, w, a, b);
      found.push(t.string.finding);
      assert.ok(t.string.finding.includes(x), `${x} in finding`);
      assert.ok(t.string.finding.includes(y), `${y} in finding`);
    }
    assert.equal(found[1], found[0], `${x} / ${y}`);
    assert.equal(found[2], found[0]);
  }
});

test('design 2.4: the lower-cased key picks the template, so mixed-case twins share a template', async () => {
  const mk = async (x, y) => {
    const w = (await H.createWall(s)).id;
    const a = (await pinOf(w, x)).id;
    const b = (await pinOf(w, y)).id;
    return (await H.tie(s, w, a, b)).string.finding;
  };
  const f1 = await mk('Wombat Society', 'Tax Return');
  const f2 = await mk('wombat society', 'tax return');
  const f3 = await mk('WOMBAT SOCIETY', 'TAX RETURN');
  assert.equal(f1.toLowerCase(), f2.toLowerCase());
  assert.equal(f3.toLowerCase(), f2.toLowerCase());
});

test('design 2.5: just below each threshold stays on the lower level (59, 119, 199) and 200 exactly is level 4', async () => {
  const cycle = (n) => Array.from({ length: n }, (_, i) => [i, (i + 1) % n]);
  const exact200 = [...Array.from({ length: 10 }, (_, k) => [2 * k, 2 * k + 1]), [0, 2], [4, 6], [8, 10]];
  const cases = [
    [7, [[0, 1], [1, 2], [3, 4], [5, 6]], 59, 1],
    [7, cycle(7), 119, 2],
    [7, H.allPairs(7).slice(0, 11), 199, 3],
    [20, exact200, 200, 4],
  ];
  for (const [n, edges, score, level] of cases) {
    assert.equal(H.scoreOf(n, edges), score);
    const { id } = await H.buildGraph(s, n, edges);
    const g = (await H.getWall(s, id)).body;
    assert.equal(g.score, score, `score ${score}`);
    assert.equal(g.level, level, `level at ${score}`);
    assert.equal(g.status, H.STATUSES[level]);
  }
});

test('design 2.5: a star scores 17k-3 for k leaves, monotone, and each cut brings the status down consistently', async () => {
  const { id, ids } = await H.buildGraph(s, 12, []);
  const edges = [];
  let prevLevel = 0;
  for (let k = 1; k <= 11; k += 1) {
    const r = await H.tie(s, id, ids[0], ids[k]);
    edges.push([0, k]);
    assert.equal(r.res.body.score, 17 * k - 3);
    assert.equal(r.res.body.score, H.scoreOf(12, edges));
    assert.equal(r.res.body.level, H.levelOf(r.res.body.score));
    assert.ok(r.res.body.level >= prevLevel);
    prevLevel = r.res.body.level;
  }
  const w = (await H.getWall(s, id)).body;
  for (let k = 0; k < 11; k += 1) {
    const cut = await s.call('DELETE', `/api/walls/${id}/strings/${w.strings[k].id}`);
    assert.equal(cut.body.score, H.scoreOf(12, edges.slice(k + 1)));
    assert.equal(cut.body.status, H.STATUSES[H.levelOf(cut.body.score)]);
  }
});

test('design 2.7: clamping and rounding on create and move for values the visible tests do not use', async () => {
  const { id } = await H.createWall(s);
  const table = [
    [[-0.4 + 0.4, 999.4], [0, 999]],
    [[1e9, -1e9], [1000, 0]],
    [[0.6, 1000.4], [1, 1000]],
    [[333.3, 666.7], [333, 667]],
    [[-1, 1001], [0, 1000]],
  ];
  for (const [input, want] of table) {
    const r = await pinOf(id, 'clamp', input);
    assert.deepEqual([r.pin.x, r.pin.y], want, `create ${input}`);
    const m = await s.call('PATCH', `/api/walls/${id}/pins/${r.id}`, { x: input[1], y: input[0] });
    assert.deepEqual([m.body.pin.x, m.body.pin.y], [want[1], want[0]], `move ${input}`);
  }
});

test('design 4: duplicate string is 409 in both orders, a cut frees the pair, a deleted pin cannot be tied', async () => {
  const { id } = await H.createWall(s);
  const [a, b, c] = await H.addPins(s, id, 3, 'dup');
  assert.equal((await H.tie(s, id, c, a)).res.status, 201);
  assert.equal((await H.tie(s, id, c, a)).res.status, 409);
  assert.equal((await H.tie(s, id, a, c)).res.status, 409);
  const st = (await H.getWall(s, id)).body.strings[0];
  assert.equal((await s.call('DELETE', `/api/walls/${id}/strings/${st.id}`)).status, 200);
  assert.equal((await H.tie(s, id, a, c)).res.status, 201);
  assert.equal((await H.tie(s, id, c, a)).res.status, 409);
  assert.equal((await s.call('DELETE', `/api/walls/${id}/pins/${b}`)).status, 200);
  const gone = await H.tie(s, id, a, b);
  assert.equal(gone.res.status, 400);
  assert.equal(gone.res.body.error.code, 'bad_pin');
});

test('design 4 and 2.5: deleting a hub pin cascades its strings, reports them and rescoring follows the formula', async () => {
  const edges = [[2, 0], [2, 1], [2, 3], [2, 4], [0, 1], [3, 4]];
  const { id, ids } = await H.buildGraph(s, 5, edges);
  const w = (await H.getWall(s, id)).body;
  assert.equal(w.score, H.scoreOf(5, edges));
  const hubStrings = w.strings.filter((x) => x.a === ids[2] || x.b === ids[2]).map((x) => x.id).sort();
  const r = await s.call('DELETE', `/api/walls/${id}/pins/${ids[2]}`);
  assert.deepEqual([...r.body.removedStrings].sort(), hubStrings);
  assert.equal(hubStrings.length, 4);
  const rest = [[0, 1], [3, 4]];
  assert.equal(r.body.score, H.scoreOf(5, rest));
  assert.equal(r.body.score, 28);
  const after = (await H.getWall(s, id)).body;
  assert.equal(after.strings.length, 2);
  assert.equal(after.score, 28);
  assert.equal(after.level, 1);
});

test('design 3 and 7: a 4096-byte body is accepted and 4097 is 413 on pins, strings and PATCH routes', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2);
  const sized = (obj, bytes) => {
    const base = JSON.stringify({ ...obj, pad: '' });
    return JSON.stringify({ ...obj, pad: 'q'.repeat(bytes - Buffer.byteLength(base)) });
  };
  const okPin = sized({ phrase: 'sized' }, 4096);
  assert.equal(Buffer.byteLength(okPin), 4096);
  assert.equal((await s.call('POST', `/api/walls/${id}/pins`, undefined, { raw: okPin })).status, 201);
  for (const [m, p, o] of [
    ['POST', `/api/walls/${id}/pins`, { phrase: 'sized' }],
    ['POST', `/api/walls/${id}/strings`, { a, b }],
    ['PATCH', `/api/walls/${id}`, { title: 'sized' }],
  ]) {
    const r = await s.call(m, p, undefined, { raw: sized(o, 4097) });
    assert.equal(r.status, 413, `${m} ${p}`);
    assert.equal(r.body.error.code, 'too_large');
  }
  const okTie = await s.call('POST', `/api/walls/${id}/strings`, undefined, { raw: sized({ a, b }, 4096) });
  assert.equal(okTie.status, 201);
});

test('design 4: id regex and ownership: 32-char ids are valid but absent, foreign pins and strings are 404', async () => {
  const w1 = (await H.createWall(s)).id;
  const w2 = (await H.createWall(s)).id;
  const [p1, q1] = await H.addPins(s, w1, 2);
  const st = (await H.tie(s, w1, p1, q1)).string;
  for (const bad of ['A'.repeat(32), 'z_-'.repeat(11), 'x'.repeat(40)]) {
    assert.equal((await H.getWall(s, bad)).status, 404, bad);
  }
  assert.equal((await s.call('PATCH', `/api/walls/${w2}/pins/${p1}`, { x: 1, y: 1 })).status, 404);
  assert.equal((await s.call('DELETE', `/api/walls/${w2}/pins/${p1}`)).status, 404);
  assert.equal((await s.call('DELETE', `/api/walls/${w2}/strings/${st.id}`)).status, 404);
  assert.equal((await H.getWall(s, w1)).body.strings.length, 1);
});

test('design 2.6: detective on a crafted wall picks the lowest degree sum, then the highest hash, and never mutates', async () => {
  const dh = (p, q) => { const [k1, k2] = [p.toLowerCase(), q.toLowerCase()].sort(); return H.fnv1a32(`detective:${k1}\u0000${k2}`); };
  const names = ['Éclair', 'Nimbus', 'ocelot', 'Pylon', 'quartz'];
  const { id } = await H.createWall(s);
  const ids = [];
  for (const n of names) ids.push((await pinOf(id, n)).id);
  const tied = [[0, 1], [0, 2], [1, 2]]; // 0,1,2 have degree 2; 3,4 have degree 0
  await H.tieEdges(s, id, ids, tied);
  const v = (await H.getWall(s, id)).body.version;
  const r = await s.call('GET', `/api/walls/${id}/detective`);
  // untied pairs: (3,4)=0, (0,3),(0,4),(1,3),(1,4),(2,3),(2,4)=2 -> only (3,4) has the lowest sum
  assert.deepEqual([r.body.suggestion.a, r.body.suggestion.b].sort(), [ids[3], ids[4]].sort());
  assert.equal(r.body.suggestion.message, 'I like Pylon and quartz together. Nobody ever asks why.');
  assert.equal((await H.getWall(s, id)).body.version, v);
  // after tying it the remaining six pairs all have degree sum 2 or 3: pick the highest hash among the lowest sum
  await H.tie(s, id, ids[4], ids[3]);
  const deg = [2, 2, 2, 1, 1];
  const pairs = H.allPairs(5).filter(([i, j]) => !tied.concat([[3, 4]]).some(([x, y]) => x === i && y === j));
  const min = Math.min(...pairs.map(([i, j]) => deg[i] + deg[j]));
  const top = pairs.filter(([i, j]) => deg[i] + deg[j] === min);
  const hs = top.map(([i, j]) => dh(names[i], names[j]));
  assert.equal(new Set(hs).size, hs.length, 'distinct hashes among the lowest-sum pairs');
  const best = top[hs.indexOf(Math.max(...hs))];
  const r2 = await s.call('GET', `/api/walls/${id}/detective`);
  assert.deepEqual([r2.body.suggestion.a, r2.body.suggestion.b].sort(), [ids[best[0]], ids[best[1]]].sort());
  assert.equal(r2.body.suggestion.message, `I like ${names[best[0]]} and ${names[best[1]]} together. Nobody ever asks why.`);
});

test('design 2.3: art is identical for case and normalisation variants and stable after restart-free reloads', async () => {
  const mk = async (phrase) => { const w = (await H.createWall(s)).id; return (await pinOf(w, phrase)).pin.art; };
  const base = await mk('Ünïcode Owl');
  assert.equal(await mk('ÜNÏCODE OWL'), base);
  assert.equal(await mk('Ünïcode  Owl'), base);
  assert.equal(await mk('  Ünïcode​ Owl '), base);
  assert.notEqual(await mk('Ünïcode Owls'), base);
  assert.match(base, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100" focusable="false"><rect width="100" height="100" fill="#[0-9a-fA-F]{6}"\/>/);
});

test('design 4.1: SSE pin-removed, pin-moved and title events carry the documented fields on a fresh wall', async () => {
  const { id } = await H.createWall(s);
  const [a, b] = await H.addPins(s, id, 2, 'sse');
  const st = (await H.tie(s, id, a, b)).string;
  const es = await H.openEvents(s, id, { clientId: 'watcher' });
  try {
    await es.waitEvent((e) => e.event === 'snapshot');
    const mv = await s.call('PATCH', `/api/walls/${id}/pins/${a}`, { x: -9, y: 1234 }, { clientId: 'Zed_9' });
    const moved = await es.waitEvent((e) => e.event === 'pin-moved');
    assert.deepEqual([moved.data.id, moved.data.x, moved.data.y, moved.data.by], [a, 0, 1000, 'Zed_9']);
    assert.equal(moved.data.score, 14);
    assert.equal(moved.id, String(mv.body.version));
    await s.call('PATCH', `/api/walls/${id}`, { title: '  Renamed   Case ' });
    const title = await es.waitEvent((e) => e.event === 'title');
    assert.equal(title.data.title, 'Renamed Case');
    assert.equal(title.data.by, null);
    const del = await s.call('DELETE', `/api/walls/${id}/pins/${b}`, undefined, { clientId: 'x'.repeat(32) });
    const gone = await es.waitEvent((e) => e.event === 'pin-removed');
    assert.equal(gone.data.id, b);
    assert.equal(gone.data.phrase, 'sse 1');
    assert.deepEqual(gone.data.removedStrings, [st.id]);
    assert.equal(gone.data.by, 'x'.repeat(32));
    assert.equal(gone.data.score, 0);
    assert.equal(gone.data.version, del.body.version);
    assert.ok(gone.dataText.indexOf('\n') < 0);
  } finally { es.close(); }
});

test('design 3 and 5: a non-GET route answers 405 with Allow, 404 JSON is unchanged, and CSP is on 413 and 405', async () => {
  const { id } = await H.createWall(s);
  const [a] = await H.addPins(s, id, 1);
  const r405 = await s.call('PUT', `/api/walls/${id}/pins/${a}`, { x: 1, y: 1 });
  assert.equal(r405.status, 405);
  assert.equal(r405.body.error.code, 'method_not_allowed');
  assert.ok(r405.headers.allow);
  assert.match(r405.headers['content-security-policy'], /default-src 'none'/);
  const r413 = await s.call('POST', `/api/walls/${id}/pins`, undefined, { raw: JSON.stringify({ phrase: 'p', pad: 'z'.repeat(4200) }) });
  assert.equal(r413.status, 413);
  assert.equal(r413.headers['x-content-type-options'], 'nosniff');
  const r404 = await s.call('DELETE', `/api/walls/${id}/strings/snothere1`);
  assert.equal(r404.status, 404);
  assert.deepEqual(r404.body, { error: { code: 'not_found', message: 'No such case' } });
});

test('design 5: case file escapes ampersands exactly once and keeps attribute quotes inert for unusual phrases', async () => {
  const phrases = ['&lt;b&gt;', "x' onfocus='y", '<svg/onload=1>', 'a"b"c'];
  const { id } = await H.createWall(s, 'Q&A <t>');
  const ids = [];
  for (const p of phrases) ids.push((await pinOf(id, p)).id);
  await H.tieEdges(s, id, ids, [[0, 1], [1, 2], [2, 3]]);
  const html = (await s.call('GET', `/w/${id}/case`)).text;
  assert.ok(html.includes('&amp;lt;b&amp;gt;'), 'literal "&lt;b&gt;" is escaped once more');
  assert.ok(!html.includes('<svg/onload'));
  assert.ok(!html.includes("x' onfocus='y"), 'single quotes are escaped');
  assert.ok(!html.includes('a"b"c'), 'double quotes are escaped');
  assert.deepEqual(H.tagsWith(html, 'case-evidence-item').map((t) => H.attrOf(t.tag, 'data-phrase')), phrases);
  assert.equal(H.textOf(html, 'case-title'), 'Q&A <t>');
});

test('design 6: a corrupt data file (empty, truncated, wrong top-level type) is renamed and the server starts empty', async () => {
  for (const junk of ['', '{"format":1,"walls":[', '[]', '{"walls":[]}']) {
    const dir = H.tmpDir();
    const file = path.join(dir, 'data.json');
    try {
      fs.writeFileSync(file, junk);
      const srv = await H.startServer({ dataFile: file });
      try {
        assert.equal((await srv.call('GET', '/healthz')).status, 200);
        const w = await H.createWall(srv, 'fresh');
        assert.equal(w.res.status, 201);
      } finally { await srv.stop(); }
      const moved = fs.readdirSync(dir).filter((f) => /^data\.json\.corrupt-\d+$/.test(f));
      assert.equal(moved.length, 1, `${JSON.stringify(junk)} -> ${fs.readdirSync(dir)}`);
      assert.equal(fs.readFileSync(path.join(dir, moved[0]), 'utf8'), junk);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('design 6: findings and art are identical after a restart and the wall id and createdAt are kept', async () => {
  const dir = H.tmpDir();
  const file = path.join(dir, 'data.json');
  try {
    let srv = await H.startServer({ dataFile: file });
    const { id } = await H.createWall(srv, 'Über Case');
    const a = (await H.addPin(srv, id, 'Fenêtre', [5, 6])).id;
    const b = (await H.addPin(srv, id, 'cheese wheel')).id;
    const c = (await H.addPin(srv, id, 'Tuesday')).id;
    await H.tie(srv, id, b, a);
    await H.tie(srv, id, c, a);
    const before = (await H.getWall(srv, id)).body;
    srv = await H.restart(srv, { dataFile: file });
    try {
      const after = (await H.getWall(srv, id)).body;
      assert.deepEqual(after, before);
      assert.deepEqual(after.strings.map((x) => [x.a, x.b]), [[b, a], [c, a]]);
      assert.equal(after.score, H.scoreOf(3, [[1, 0], [2, 0]]));
    } finally { await srv.stop(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('design 3: the wall holds 100 pins, then wall_full; a full wall still takes strings and moves', async () => {
  const { id } = await H.createWall(s);
  const ids = await H.addPins(s, id, 100, 'cap');
  const full = await pinOf(id, 'cap 100');
  assert.equal(full.res.status, 400);
  assert.equal(full.res.body.error.code, 'wall_full');
  assert.equal((await H.tie(s, id, ids[0], ids[99])).res.status, 201);
  assert.equal((await s.call('PATCH', `/api/walls/${id}/pins/${ids[50]}`, { x: 10, y: 10 })).status, 200);
  assert.equal((await H.getWall(s, id)).body.pins.length, 100);
});
