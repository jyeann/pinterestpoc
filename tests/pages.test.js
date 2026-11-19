'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pages = require('../src/pages');

const { escapeHtml, caseFileHtml, notFoundHtml, wallShellHtml, homeHtml } = pages;

const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const tagsWith = (html, id) => {
  const re = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\bdata-testid="${id}"[^>]*>`, 'g');
  return [...html.matchAll(re)].map((m) => m[0]);
};
const has = (html, id) => tagsWith(html, id).length > 0;
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]) : null;
};
const textOf = (html, id) => {
  const t = tagsWith(html, id)[0];
  if (!t) return null;
  const start = html.indexOf(t) + t.length;
  const name = /^<([a-zA-Z0-9]+)/.exec(t)[1];
  const end = html.indexOf(`</${name}>`, start);
  return decode(html.slice(start, end).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
};
const noInline = (html) => {
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'no inline script');
  assert.ok(!/<style[\s>]/i.test(html), 'no style element');
  assert.ok(!/\sstyle\s*=/i.test(html), 'no style attribute');
  assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), 'no inline handler');
};

const ART = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" focusable="false"><rect width="100" height="100" fill="#112233"/></svg>';
const mkWall = (over = {}) => {
  const pins = [];
  const count = over.pinCount === undefined ? 2 : over.pinCount;
  for (let i = 0; i < count; i += 1) pins.push({ id: `p${i}`, phrase: `pin ${i}`, x: 10, y: 10, art: ART });
  const strings = over.strings === undefined ? [{ id: 's0', a: 'p0', b: 'p1', finding: 'pin 0 and pin 1 met.' }] : over.strings;
  return {
    id: 'Wall_abc-123', title: 'My Case', version: 3, pins, strings, score: 14, level: 0, status: 'Hunch', ...(over.wall || {}),
  };
};

test('escapeHtml escapes the five dangerous characters exactly once', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml('a&amp;b'), 'a&amp;amp;b');
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('escapeHtml tolerates null, undefined, numbers and empty input', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(42), '42');
});

test('escapeHtml leaves emoji and unicode untouched', () => {
  assert.equal(escapeHtml('pigeons \u{1F426} café'), 'pigeons \u{1F426} café');
});

test('caseFileHtml renders every required testid and the wall values', () => {
  const html = caseFileHtml(mkWall({ wall: { level: 1, status: 'Theory', score: 24 } }));
  for (const id of ['case', 'case-title', 'case-status', 'case-score', 'case-evidence', 'case-findings', 'case-print', 'case-back']) {
    assert.ok(has(html, id), id);
  }
  assert.equal(textOf(html, 'case-title'), 'My Case');
  assert.equal(textOf(html, 'case-status'), 'Theory');
  assert.equal(attr(tagsWith(html, 'case-status')[0], 'data-level'), '1');
  assert.equal(textOf(html, 'case-score'), '24');
  assert.equal(tagsWith(html, 'case-evidence-item').length, 2);
  assert.equal(tagsWith(html, 'case-finding').length, 1);
  assert.equal(/^<(\w+)/.exec(tagsWith(html, 'case-findings')[0])[1], 'ol');
  assert.ok(html.includes('pin 0 and pin 1 met.'));
  assert.match(html, /<script[^>]+src="\/static\/case\.js"/);
  assert.match(html, /<link[^>]+href="\/static\/case\.css"/);
  assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width/);
  noInline(html);
});

test('caseFileHtml embeds the art raw and keeps the status text in its original case', () => {
  const html = caseFileHtml(mkWall({ wall: { level: 4, status: "They don't want you to know" } }));
  assert.ok(html.includes(ART));
  assert.equal(textOf(html, 'case-status'), "They don't want you to know");
  assert.equal(attr(tagsWith(html, 'case-status')[0], 'data-level'), '4');
});

test('caseFileHtml links back to the wall and prints via a button', () => {
  const html = caseFileHtml(mkWall());
  assert.equal(attr(tagsWith(html, 'case-back')[0], 'href'), '/w/Wall_abc-123');
  assert.match(tagsWith(html, 'case-print')[0], /^<button\b/);
  assert.match(tagsWith(html, 'case-print')[0], /type="button"/);
});

test('caseFileHtml escapes hostile phrases, titles and findings', () => {
  const hostile = [
    '<img src=x onerror=alert(1)>', '" onmouseover="x', "it's <b>bold</b>", 'a&b &amp; c', '</li></ol><script>boom()</script>',
  ];
  const wall = mkWall({
    pinCount: 0,
    strings: hostile.map((h, i) => ({ id: `s${i}`, a: 'a', b: 'b', finding: `${h} and ${h} were seen.` })),
    wall: { title: '<script>alert("t")</script>' },
  });
  wall.pins = hostile.map((h, i) => ({ id: `p${i}`, phrase: h, x: 1, y: 1, art: ART }));
  const html = caseFileHtml(wall);
  assert.ok(!html.includes('<img'));
  assert.ok(!/<script>(alert|boom)/.test(html));
  assert.ok(!html.includes('<b>bold</b>'));
  assert.ok(!html.includes('" onmouseover="'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('a&amp;b &amp;amp; c'));
  assert.equal(textOf(html, 'case-title'), '<script>alert("t")</script>');
  const items = tagsWith(html, 'case-evidence-item').map((t) => attr(t, 'data-phrase'));
  assert.deepEqual(items, hostile);
  assert.equal(tagsWith(html, 'case-finding').length, hostile.length);
  assert.ok(/<title>[^<]*&lt;script&gt;/.test(html), 'document title is escaped');
});

test('caseFileHtml for an empty wall says "No evidence. No case." and has no items', () => {
  const html = caseFileHtml(mkWall({ pinCount: 0, strings: [] }));
  assert.ok(html.includes('No evidence. No case.'));
  assert.equal(tagsWith(html, 'case-evidence-item').length, 0);
  assert.equal(tagsWith(html, 'case-finding').length, 0);
  assert.ok(has(html, 'case-evidence'));
  assert.ok(has(html, 'case-findings'));
});

test('caseFileHtml says "No strings. No theory." only when there are no findings', () => {
  assert.ok(caseFileHtml(mkWall({ strings: [] })).includes('No strings. No theory.'));
  assert.ok(!caseFileHtml(mkWall()).includes('No strings. No theory.'));
});

test('caseFileHtml renders a pin without art as just its phrase', () => {
  const wall = mkWall({ pinCount: 1, strings: [] });
  delete wall.pins[0].art;
  const html = caseFileHtml(wall);
  assert.ok(!html.includes('undefined'));
  assert.equal(tagsWith(html, 'case-evidence-item').length, 1);
});

test('caseFileHtml omits the empty copy once there is evidence', () => {
  const html = caseFileHtml(mkWall({ pinCount: 1, strings: [] }));
  assert.ok(!html.includes('No evidence. No case.'));
  assert.equal(tagsWith(html, 'case-evidence-item').length, 1);
});

test('caseFileHtml adds "many" only above 24 pins and "dense" only above 60', () => {
  const many = (html) => /class="[^"]*\bmany\b[^"]*"/.test(html);
  const dense = (html) => /class="[^"]*\bdense\b[^"]*"/.test(html);
  const at = (n) => caseFileHtml(mkWall({ pinCount: n, strings: [] }));
  assert.equal(many(at(24)), false);
  assert.equal(many(at(25)), true);
  assert.equal(dense(at(60)), false);
  assert.equal(dense(at(61)), true);
  assert.equal(many(at(61)), true);
  assert.equal(many(at(0)), false);
  assert.equal(dense(at(100)), true);
});

test('caseFileHtml survives a wall with missing arrays and values', () => {
  const html = caseFileHtml({ id: 'abc' });
  assert.ok(html.includes('No evidence. No case.'));
  assert.equal(textOf(html, 'case-score'), '0');
  assert.equal(textOf(html, 'case-status'), 'Hunch');
  assert.equal(attr(tagsWith(html, 'case-status')[0], 'data-level'), '0');
  assert.ok(textOf(html, 'case-title').length > 0);
});

test('caseFileHtml survives null and non-object input without throwing', () => {
  assert.equal(attr(tagsWith(caseFileHtml(null), 'case-back')[0], 'href'), '/');
  assert.equal(attr(tagsWith(caseFileHtml({ id: 'bad id' }), 'case-back')[0], 'href'), '/');
  assert.equal(attr(tagsWith(caseFileHtml({ id: 7 }), 'case-back')[0], 'href'), '/');
  assert.ok(caseFileHtml(null).includes('No evidence. No case.'));
  assert.ok(caseFileHtml(undefined).includes('No evidence. No case.'));
});

test('notFoundHtml has the not-found testids, copy and a home link, with no inline code', () => {
  const html = notFoundHtml();
  for (const id of ['notfound', 'notfound-title', 'notfound-text', 'notfound-home']) assert.ok(has(html, id), id);
  assert.equal(textOf(html, 'notfound-title'), 'No such case');
  assert.equal(textOf(html, 'notfound-text'), 'Nobody filed that one, or somebody made it disappear.');
  assert.equal(textOf(html, 'notfound-home'), 'Open a new case');
  assert.equal(attr(tagsWith(html, 'notfound-home')[0], 'href'), '/');
  assert.match(html, /<meta[^>]+name="viewport"/);
  noInline(html);
});

test('wallShellHtml has every wall testid in the keyboard tab order', () => {
  const html = wallShellHtml('Abc123_-xyz0');
  const ids = ['wall', 'wall-title', 'wall-status', 'wall-score', 'conn-status', 'theme-toggle', 'share-link', 'close-case',
    'phrase-form', 'phrase-input', 'phrase-submit', 'phrase-error', 'detective-btn', 'board', 'string-layer', 'announcer',
    'wall-loading', 'empty-state', 'tie-hint', 'finding-panel', 'finding-heading', 'finding-text', 'finding-pair',
    'finding-delete', 'finding-close', 'detective-panel', 'detective-message', 'detective-accept', 'detective-dismiss',
    'wall-error', 'wall-retry'];
  for (const id of ids) assert.ok(has(html, id), id);
  const order = ['wall-title', 'share-link', 'theme-toggle', 'close-case', 'phrase-input', 'phrase-submit', 'detective-btn'];
  const positions = order.map((id) => html.indexOf(`data-testid="${id}"`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'tab order follows DOM order');
  assert.match(html, /<script[^>]+src="\/static\/wall\.js"/);
  assert.match(html, /<link[^>]+href="\/static\/wall\.css"/);
  assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width, initial-scale=1/);
  noInline(html);
});

test('wallShellHtml has the roles and labels ux.md requires', () => {
  const html = wallShellHtml('abc');
  assert.equal(attr(tagsWith(html, 'board')[0], 'role'), 'group');
  assert.equal(attr(tagsWith(html, 'board')[0], 'aria-label'), 'Evidence wall');
  assert.equal(attr(tagsWith(html, 'announcer')[0], 'role'), 'status');
  assert.equal(attr(tagsWith(html, 'announcer')[0], 'aria-live'), 'polite');
  assert.equal(attr(tagsWith(html, 'phrase-error')[0], 'role'), 'alert');
  assert.equal(attr(tagsWith(html, 'wall-error')[0], 'role'), 'alert');
  assert.equal(attr(tagsWith(html, 'finding-panel')[0], 'role'), 'dialog');
  assert.equal(attr(tagsWith(html, 'finding-panel')[0], 'aria-labelledby'), 'finding-heading');
  assert.equal(attr(tagsWith(html, 'wall-title')[0], 'aria-label'), 'Case name');
  assert.equal(attr(tagsWith(html, 'phrase-input')[0], 'placeholder'), 'pigeons');
  assert.ok(!/maxlength/i.test(tagsWith(html, 'phrase-input')[0]), 'phrase box has no maxlength');
  assert.equal(attr(tagsWith(html, 'phrase-input')[0], 'aria-describedby'), 'phrase-error');
  assert.equal(attr(tagsWith(html, 'detective-panel')[0], 'tabindex'), '-1');
  assert.equal(textOf(html, 'phrase-submit'), 'Pin it');
  assert.equal(textOf(html, 'detective-btn'), 'Ask the Detective');
  assert.equal(textOf(html, 'close-case'), 'Close the case');
  assert.equal(textOf(html, 'share-link'), 'Copy link');
  assert.equal(textOf(html, 'wall-loading'), 'Dusting for prints...');
  assert.equal(textOf(html, 'empty-state'), 'Nothing on the wall. Type something you saw.');
  assert.equal(textOf(html, 'wall-error'), 'The wall would not talk. Reload and try again. Reload');
  assert.match(html, /<label[^>]+for="phrase-input"[^>]*>\s*What did you see\?/);
});

test('wallShellHtml initial states: loading shown, errors and panels hidden', () => {
  const html = wallShellHtml('abc');
  for (const id of ['phrase-error', 'wall-error', 'tie-hint', 'finding-panel', 'detective-panel', 'empty-state']) {
    assert.match(tagsWith(html, id)[0], /\bhidden\b/, `${id} starts hidden`);
  }
  assert.ok(!/\bhidden\b/.test(tagsWith(html, 'wall-loading')[0]));
  assert.equal(textOf(html, 'wall-score'), '-');
  assert.equal(textOf(html, 'wall-status'), '-');
});

test('wallShellHtml points close-case at this wall for a valid id and holds no wall data', () => {
  const html = wallShellHtml('Abc123_-xyz0');
  assert.equal(attr(tagsWith(html, 'close-case')[0], 'href'), '/w/Abc123_-xyz0/case');
});

test('wallShellHtml never reflects an id that is not a plain wall id', () => {
  for (const bad of ['<script>alert(1)</script>', 'a"b', '', undefined, null, 42, 'x'.repeat(33), 'a b']) {
    const html = wallShellHtml(bad);
    assert.ok(!html.includes('alert(1)'));
    assert.ok(!html.includes('a"b'));
    assert.ok(!html.includes('/w/xxxx'));
    assert.equal(attr(tagsWith(html, 'close-case')[0], 'href'), '/', String(bad));
  }
  assert.equal(attr(tagsWith(wallShellHtml(), 'close-case')[0], 'href'), '/');
  assert.equal(attr(tagsWith(wallShellHtml('x'.repeat(32)), 'close-case')[0], 'href'), `/w/${'x'.repeat(32)}/case`);
});

test('homeHtml has the home testids and copy, and matches public/index.html', () => {
  const html = homeHtml();
  for (const id of ['home', 'home-title', 'home-tagline', 'home-new-case', 'home-error']) assert.ok(has(html, id), id);
  assert.equal(textOf(html, 'home-title'), 'RED STRING');
  assert.equal(textOf(html, 'home-tagline'), 'Everything is connected. You just have not proved it yet.');
  assert.equal(textOf(html, 'home-new-case'), 'Open a new case');
  assert.equal(attr(tagsWith(html, 'home-error')[0], 'role'), 'alert');
  assert.match(tagsWith(html, 'home-error')[0], /\bhidden\b/);
  assert.match(html, /<script[^>]+src="\/static\/home\.js"/);
  assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width/);
  noInline(html);
  const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.equal(file, html);
});
