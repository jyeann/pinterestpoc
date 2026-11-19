'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { artSvg } = require('../src/art');

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" focusable="false"><rect width="100" height="100" fill="#[0-9a-f]{6}"/>';
const NUM = '\\d{1,3}\\.\\d';
const FILL = ' fill="#[0-9a-f]{6}"( opacity="[01]\\.\\d")?';
const CIRCLE = `<circle cx="${NUM}" cy="${NUM}" r="${NUM}"${FILL}/>`;
const RECT = `<rect x="${NUM}" y="${NUM}" width="${NUM}" height="${NUM}"${FILL} transform="rotate\\(${NUM} 50 50\\)"/>`;
const POLY = `<polygon points="${NUM},${NUM} ${NUM},${NUM} ${NUM},${NUM}"${FILL}/>`;
const FULL = new RegExp(`^${HEAD}((${CIRCLE})|(${RECT})|(${POLY})){3,6}</svg>$`);

const PHRASES = ['pigeons', 'the moon', 'a', '\u{1F600} emoji', 'x'.repeat(60), 'Area 51', 'q', 'zebra crossing', 'tin foil'];

test('structure matches spec for many phrases', () => {
  for (const p of PHRASES) {
    const svg = artSvg(p);
    assert.match(svg, FULL, p);
    assert.ok(!svg.includes('>' + ' ') && !/>\s+</.test(svg));
  }
});

test('deterministic and case-insensitive', () => {
  assert.equal(artSvg('Pigeons'), artSvg('pigeons'));
  assert.equal(artSvg('pigeons'), artSvg('pigeons'));
});

test('different phrases give different art', () => {
  const set = new Set(PHRASES.map(artSvg));
  assert.equal(set.size, PHRASES.length);
});

test('forbidden content absent and phrase not embedded', () => {
  for (const p of PHRASES) {
    const svg = artSvg(p);
    assert.doesNotMatch(svg.replace(' xmlns="http://www.w3.org/2000/svg"', ''), /<script|href|url\(|\son\w+=|https?:|javascript/i);
    if (p.length > 2) assert.ok(!svg.includes(p));
  }
  assert.doesNotMatch(artSvg('<script>alert(1)</script>'), /<script|alert/);
});

test('shape counts span 3..6 and all kinds appear', () => {
  const counts = new Set();
  let c = 0, r = 0, p = 0;
  for (let i = 0; i < 300; i++) {
    const svg = artSvg('phrase ' + i);
    const n = (svg.match(/<(circle|polygon)|<rect (?!width="100")/g) || []).length;
    counts.add(n);
    c += svg.includes('<circle') ? 1 : 0;
    r += svg.includes('<rect x=') ? 1 : 0;
    p += svg.includes('<polygon') ? 1 : 0;
    assert.ok(n >= 3 && n <= 6);
  }
  assert.deepEqual([...counts].sort(), [3, 4, 5, 6]);
  assert.ok(c > 0 && r > 0 && p > 0);
});

test('background comes from palette and opacity is within 0.5..1.0', () => {
  const bgs = new Set();
  for (let i = 0; i < 300; i++) {
    const svg = artSvg('bg' + i);
    bgs.add(/fill="(#[0-9a-f]{6})"/.exec(svg)[1]);
    for (const m of svg.matchAll(/opacity="([\d.]+)"/g)) {
      assert.ok(Number(m[1]) >= 0.5 && Number(m[1]) <= 1.0);
    }
  }
  assert.ok(bgs.size > 1 && bgs.size <= 8);
});
