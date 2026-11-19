'use strict';
// Pages: home, wall shell, case file, not-found, static files (design 5, ux.md testids and copy).
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const page = (p) => s.call('GET', p);
const noInline = (html) => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline <script>');
  assert.ok(!/<style[\s>]/i.test(html), 'no <style> element');
  assert.ok(!/\sstyle\s*=/i.test(html), 'no style attribute');
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), 'no inline event handler');
};
const HOSTILE = [
  '<img src=x onerror=alert(1)>',
  '" onmouseover="x',
  "it's <b>bold</b>",
  'a&b &amp; c',
  '</li></ol><script>boom()</script>',
];

test('GET / is the home page with the ux testids and no inline script or style', async () => {
  const r = await page('/');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  for (const id of ['home', 'home-title', 'home-tagline', 'home-new-case', 'home-error']) {
    assert.ok(H.hasTestId(r.text, id), `testid ${id}`);
  }
  assert.equal(H.textOf(r.text, 'home-title'), 'RED STRING');
  assert.equal(H.textOf(r.text, 'home-tagline'), 'Everything is connected. You just have not proved it yet.');
  assert.equal(H.textOf(r.text, 'home-new-case'), 'Open a new case');
  assert.match(r.text, /<meta[^>]+name="viewport"[^>]+width=device-width/i);
  assert.match(r.text, /<script[^>]+src="\/static\//);
  noInline(r.text);
});

test('wall shell at /w/:id and /w/:id/ has the wall testids and none of the wall data', async () => {
  const { id } = await H.createWall(s, 'ShellTitleQQ');
  await H.addPin(s, id, 'shell-phrase-zzq');
  for (const p of [`/w/${id}`, `/w/${id}/`]) {
    const r = await page(p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers['content-type'], /^text\/html/);
    for (const t of ['wall', 'wall-title', 'wall-status', 'wall-score', 'conn-status', 'theme-toggle', 'share-link', 'close-case',
      'phrase-form', 'phrase-input', 'phrase-submit', 'phrase-error', 'detective-btn', 'board', 'announcer']) {
      assert.ok(H.hasTestId(r.text, t), `${p} testid ${t}`);
    }
    assert.ok(!r.text.includes('ShellTitleQQ'));
    assert.ok(!r.text.includes('shell-phrase-zzq'));
    assert.match(r.text, /<meta[^>]+name="viewport"/i);
    noInline(r.text);
  }
});

test('close-case on the wall shell links to the case file', async () => {
  const { id } = await H.createWall(s);
  const r = await page(`/w/${id}`);
  const tag = H.tagsWith(r.text, 'close-case')[0];
  assert.ok(tag);
  assert.match(H.attrOf(tag.tag, 'href'), new RegExp(`^/w/${id}/case/?$`));
});

test('unknown wall ids give the 404 "No such case" page on both wall routes', async () => {
  for (const p of ['/w/doesnotexist', '/w/doesnotexist/case', '/w/doesnotexist/']) {
    const r = await page(p);
    assert.equal(r.status, 404, p);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.ok(H.hasTestId(r.text, 'notfound'), p);
    assert.equal(H.textOf(r.text, 'notfound-title'), 'No such case');
    assert.equal(H.textOf(r.text, 'notfound-text'), 'Nobody filed that one, or somebody made it disappear.');
    const home = H.tagsWith(r.text, 'notfound-home')[0];
    assert.ok(home);
    assert.equal(H.attrOf(home.tag, 'href'), '/');
    assert.equal(H.textOf(r.text, 'notfound-home'), 'Open a new case');
    noInline(r.text);
  }
});

test('the 404 page does not reflect the requested id; ids outside the id regex are 404 too', async () => {
  const r = await page('/w/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.equal(r.status, 404);
  assert.ok(!r.text.includes('alert(1)'));
  assert.equal((await page(`/w/${'a'.repeat(33)}`)).status, 404);
  assert.equal((await page('/w/a.b/case')).status, 404);
});

test('case file for an empty wall says "No evidence. No case." and shows status and score', async () => {
  const { id } = await H.createWall(s, 'Empty Case');
  const r = await page(`/w/${id}/case`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /^text\/html/);
  for (const t of ['case', 'case-title', 'case-status', 'case-score', 'case-evidence', 'case-findings', 'case-print', 'case-back']) {
    assert.ok(H.hasTestId(r.text, t), `testid ${t}`);
  }
  assert.equal(H.textOf(r.text, 'case-title'), 'Empty Case');
  assert.equal(H.textOf(r.text, 'case-status'), 'Hunch');
  assert.equal(H.attrOf(H.tagsWith(r.text, 'case-status')[0].tag, 'data-level'), '0');
  assert.equal(H.textOf(r.text, 'case-score'), '0');
  assert.ok(r.text.includes('No evidence. No case.'));
  assert.equal(H.tagsWith(r.text, 'case-evidence-item').length, 0);
});

test('case file lists every pin with art and every finding, status uppercase only by CSS', async () => {
  const { id, ids } = await H.buildGraph(s, 4, [[0, 1], [1, 2], [2, 3]], 'Big Case');
  const wall = (await H.getWall(s, id)).body;
  const r = await page(`/w/${id}/case`);
  assert.equal(r.status, 200);
  assert.equal(H.textOf(r.text, 'case-title'), 'Big Case');
  assert.equal(H.textOf(r.text, 'case-score'), String(wall.score));
  assert.equal(H.textOf(r.text, 'case-status'), wall.status);
  assert.equal(H.attrOf(H.tagsWith(r.text, 'case-status')[0].tag, 'data-level'), String(wall.level));
  const items = H.tagsWith(r.text, 'case-evidence-item');
  assert.equal(items.length, 4);
  items.forEach((t, i) => {
    assert.equal(H.attrOf(t.tag, 'data-phrase'), wall.pins[i].phrase);
    const inner = H.innerOf(r.text, t);
    assert.ok(inner.includes(wall.pins[i].art), `art embedded raw for pin ${i}`);
    assert.ok(H.decodeEntities(inner).includes(wall.pins[i].phrase));
  });
  const findings = H.tagsWith(r.text, 'case-finding').map((t) => H.decodeEntities(H.innerOf(r.text, t).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
  assert.deepEqual([...findings].sort(), wall.strings.map((x) => x.finding).sort());
  assert.equal(H.tagsWith(r.text, 'case-findings')[0].name, 'ol');
  assert.equal(ids.length, 4);
  noInline(r.text);
});

test('case file links: case-back goes to the wall, case-print is wired by /static/case.js', async () => {
  const { id } = await H.createWall(s);
  const r = await page(`/w/${id}/case`);
  const back = H.tagsWith(r.text, 'case-back')[0];
  assert.match(H.attrOf(back.tag, 'href'), new RegExp(`^/w/${id}/?$`));
  assert.ok(H.tagsWith(r.text, 'case-print').length === 1);
  assert.match(r.text, /<script[^>]+src="\/static\/case\.js"/);
});

test('case file shows the top status text for a level 4 wall', async () => {
  const { id } = await H.buildGraph(s, 6, H.allPairs(6).slice(0, 11));
  const r = await page(`/w/${id}/case`);
  assert.equal(H.attrOf(H.tagsWith(r.text, 'case-status')[0].tag, 'data-level'), '4');
  assert.equal(H.textOf(r.text, 'case-status'), "They don't want you to know");
});

test('hostile phrases, titles and findings are HTML-escaped in the case file', async () => {
  const { id } = await H.createWall(s, '<script>alert("t")</script>');
  const pids = [];
  for (const h of HOSTILE) pids.push((await H.addPin(s, id, h)).id);
  await H.tieEdges(s, id, pids, [[0, 1], [1, 2], [2, 3], [3, 4]]);
  const wall = (await H.getWall(s, id)).body;
  const r = await page(`/w/${id}/case`);
  assert.equal(r.status, 200);
  const html = r.text;
  assert.ok(!html.includes('<img'), 'no raw <img> from a phrase');
  assert.ok(!/<script>(alert|boom)/.test(html), 'no raw script from a title or phrase');
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(!html.includes('" onmouseover="'), 'quote cannot break out of an attribute');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('a&amp;b &amp;amp; c'), 'ampersands escaped exactly once');
  assert.equal(H.textOf(html, 'case-title'), '<script>alert("t")</script>');
  const items = H.tagsWith(html, 'case-evidence-item');
  assert.deepEqual(items.map((t) => H.attrOf(t.tag, 'data-phrase')), HOSTILE);
  const findings = H.tagsWith(html, 'case-finding').map((t) => H.decodeEntities(H.innerOf(html, t).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
  assert.deepEqual([...findings].sort(), wall.strings.map((x) => x.finding.replace(/\s+/g, ' ').trim()).sort());
});

test('case file adds class "many" only above 24 pins', async () => {
  const small = (await H.createWall(s)).id;
  await H.addPins(s, small, 24);
  const big = (await H.createWall(s)).id;
  await H.addPins(s, big, 25);
  const hasMany = (html) => /class="[^"]*\bmany\b[^"]*"/.test(html);
  assert.equal(hasMany((await page(`/w/${small}/case`)).text), false);
  assert.equal(hasMany((await page(`/w/${big}/case`)).text), true);
});

test('static files: scripts and styles are served with a matching content-type', async () => {
  for (const [file, re] of [['wall.js', /javascript/], ['home.js', /javascript/], ['case.js', /javascript/], ['wall.css', /css/], ['case.css', /css/]]) {
    const r = await page(`/static/${file}`);
    assert.equal(r.status, 200, file);
    assert.match(r.headers['content-type'], re, file);
    assert.ok(r.text.length > 0);
  }
});

test('static: unknown names, nested paths and traversal attempts are 404 and never leak files', async () => {
  const paths = [
    '/static/nope.js', '/static/', '/static/sub/wall.js', '/static/..', '/static/.',
    '/static/../package.json', '/static/..%2fpackage.json', '/static/%2e%2e%2fpackage.json', '/static/%2e%2e/package.json',
    '/static/../src/main.js', '/static/..%2fsrc%2fmain.js', '/static/..\\package.json', '/static//etc/passwd',
  ];
  for (const p of paths) {
    const r = await H.rawGet(s, p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.text.includes('"red-string"'), p);
    assert.ok(!r.text.includes("require('node:"), p);
  }
});
