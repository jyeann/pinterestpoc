'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { finding, TEMPLATES } = require('../src/findings');

test('templates: >= 16, each with {A} and {B} exactly once', () => {
  assert.ok(TEMPLATES.length >= 16);
  for (const t of TEMPLATES) {
    assert.equal(t.split('{A}').length, 2, t);
    assert.equal(t.split('{B}').length, 2, t);
  }
  assert.equal(new Set(TEMPLATES).size, TEMPLATES.length);
});

test('symmetry: pair order does not change the text', () => {
  const pairs = [['pigeons', 'the moon'], ['Area 51', 'tin foil'], ['a', 'b'], ['Zed', 'alpha']];
  for (const [a, b] of pairs) assert.equal(finding(a, b), finding(b, a));
});

test('case-insensitive template choice, display form kept', () => {
  const x = finding('Pigeons', 'The Moon');
  const y = finding('pigeons', 'the moon');
  assert.equal(x.replace('Pigeons', 'pigeons').replace('The Moon', 'the moon'), y);
  assert.ok(x.includes('Pigeons') && x.includes('The Moon'));
});

test('first phrase is the lower key', () => {
  const t = finding('zebra', 'apple');
  const tpl = TEMPLATES.find((s) => t === s.replace('{A}', 'apple').replace('{B}', 'zebra'));
  assert.ok(tpl, t);
});

test('equal keys with different display are symmetric', () => {
  assert.equal(finding('Moon', 'moon'), finding('moon', 'Moon'));
  assert.equal(finding('same', 'same').split('same').length, 3);
});

test('distinct pairs spread across templates; $ in phrases is literal', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(finding('p' + i, 'q' + i).replace(/p\d+|q\d+/g, '#'));
  assert.ok(seen.size >= 8);
  assert.ok(finding('$&', "$'").includes('$&'));
  assert.ok(finding('$&', "$'").includes("$'"));
});
