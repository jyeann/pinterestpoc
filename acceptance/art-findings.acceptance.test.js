'use strict';
// Deterministic art (design 2.3) and findings (design 2.4), observed through the API.
const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.js');

let s;
before(async () => { s = await H.startServer(); });
after(async () => { await s.stop(); });

const artOf = async (phrase) => {
  const { id } = await H.createWall(s);
  return (await H.addPin(s, id, phrase)).pin.art;
};
const STRUCTURE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100" focusable="false"><rect width="100" height="100" fill="#[0-9a-fA-F]{6}"\/>((?:<(?:circle|rect|polygon) [^>]*\/>){3,6})<\/svg>$/;

test('art has the exact SVG wrapper, a background rect and 3 to 6 shapes with no whitespace between tags', async () => {
  for (const phrase of ['pigeons', 'the moon', 'ufo', 'Tuesday']) {
    const art = await artOf(phrase);
    const m = STRUCTURE.exec(art);
    assert.ok(m, `structure of art for ${phrase}: ${art.slice(0, 200)}`);
    assert.ok(!/>\s+</.test(art), 'no whitespace between tags');
    const shapes = m[1].match(/<(circle|rect|polygon) /g);
    assert.ok(shapes.length >= 3 && shapes.length <= 6);
  }
});

test('shapes use one-decimal numbers, circle/rect/polygon attributes and palette fills', async () => {
  const kinds = new Set();
  for (const phrase of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']) {
    const art = await artOf(phrase);
    const body = art.replace(/^<svg[^>]*><rect[^>]*\/>/, '');
    for (const tag of body.match(/<(circle|rect|polygon) [^>]*\/>/g)) {
      const kind = /^<(\w+)/.exec(tag)[1];
      kinds.add(kind);
      assert.match(tag, /fill="#[0-9a-fA-F]{6}"/);
      if (kind === 'circle') assert.match(tag, /cx="\d{1,3}\.\d" cy="\d{1,3}\.\d" r="\d{1,3}\.\d"/);
      if (kind === 'rect') assert.match(tag, /transform="rotate\(-?\d{1,3}\.\d 50 50\)"/);
      if (kind === 'polygon') assert.match(tag, /points="\d{1,3}\.\d,\d{1,3}\.\d \d{1,3}\.\d,\d{1,3}\.\d \d{1,3}\.\d,\d{1,3}\.\d"/);
      const op = /opacity="([^"]+)"/.exec(tag);
      if (op) assert.ok(Number(op[1]) >= 0.5 && Number(op[1]) <= 1, `opacity ${op[1]}`);
    }
  }
  assert.ok(kinds.size === 3, `all three shape kinds appear across samples, saw ${[...kinds]}`);
});

test('art never contains the phrase, text, links, scripts or handlers', async () => {
  for (const phrase of ['unique-marker-zzq', '<script>alert(1)</script>', 'javascript:alert(1)']) {
    const art = await artOf(phrase);
    assert.ok(!art.includes(phrase));
    const stripped = art.replace('xmlns="http://www.w3.org/2000/svg"', '');
    assert.ok(!/<script|href|url\(|<text|<image|<style|<foreignObject|https?:|\son\w+\s*=/i.test(stripped), stripped);
  }
});

test('the same phrase gives byte-identical art on the same wall, on other walls and via GET', async () => {
  const w1 = (await H.createWall(s)).id;
  const w2 = (await H.createWall(s)).id;
  const a = (await H.addPin(s, w1, 'pigeons')).pin.art;
  const b = (await H.addPin(s, w1, 'pigeons')).pin.art;
  const c = (await H.addPin(s, w2, 'pigeons')).pin.art;
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal((await H.getWall(s, w1)).body.pins[0].art, a);
});

test('art key is the lower-cased phrase: case does not change it; different phrases differ', async () => {
  assert.equal(await artOf('Pigeons'), await artOf('pigeons'));
  assert.equal(await artOf('THE MOON'), await artOf('the moon'));
  const set = new Set();
  for (const p of ['pigeons', 'the moon', 'ufo', 'cat', 'sock', 'tuesday']) set.add(await artOf(p));
  assert.equal(set.size, 6);
});

test('backgrounds come from at most 8 fixed palettes', async () => {
  const { id } = await H.createWall(s);
  const bgs = new Set();
  for (let i = 0; i < 40; i += 1) {
    const art = (await H.addPin(s, id, `sample ${i}`)).pin.art;
    bgs.add(/<rect width="100" height="100" fill="(#[0-9a-fA-F]{6})"/.exec(art)[1].toLowerCase());
  }
  assert.ok(bgs.size >= 2, 'more than one background appears');
  assert.ok(bgs.size <= 8, `at most 8 palettes, saw ${bgs.size}`);
});

// ---- findings ----
const tieFinding = async (pA, pB, wallId) => {
  const id = wallId || (await H.createWall(s)).id;
  const a = (await H.addPin(s, id, pA)).id;
  const b = (await H.addPin(s, id, pB)).id;
  const r = await H.tie(s, id, a, b);
  return r.string.finding;
};

test('a finding names both phrases exactly once, as plain text with no placeholders left', async () => {
  const f = await tieFinding('Zq Alpha', 'Mx Bravo');
  assert.equal(f.split('Zq Alpha').length - 1, 1);
  assert.equal(f.split('Mx Bravo').length - 1, 1);
  assert.ok(!/[{}]/.test(f), f);
  assert.ok(!/</.test(f));
});

test('the finding is identical whichever pin is A, on any wall', async () => {
  for (const [x, y] of [['zq alpha', 'mx bravo'], ['the moon', 'pigeons'], ['Kettle', 'Tuesday']]) {
    const f1 = await tieFinding(x, y);
    const f2 = await tieFinding(y, x);
    const f3 = await tieFinding(x, y);
    assert.equal(f2, f1, `${x} / ${y}`);
    assert.equal(f3, f1);
  }
});

test('the finding picks its template by lower-cased phrase, so case only changes the shown phrase', async () => {
  const f1 = await tieFinding('Zq Alpha', 'Mx Bravo');
  const f2 = await tieFinding('zq alpha', 'mx bravo');
  const f3 = await tieFinding('ZQ ALPHA', 'mx BRAVO');
  assert.equal(f1.toLowerCase(), f2.toLowerCase());
  assert.equal(f3.toLowerCase(), f2.toLowerCase());
});

test('findings use many different templates and the stored finding matches the tie response', async () => {
  const templates = new Set();
  let last;
  for (let i = 0; i < 60; i += 1) {
    const w = (await H.createWall(s)).id;
    const A = `qaa${i}x`;
    const B = `qbb${i}y`;
    const pa = (await H.addPin(s, w, A)).id;
    const pb = (await H.addPin(s, w, B)).id;
    const r = await H.tie(s, w, pa, pb);
    last = { w, finding: r.string.finding, id: r.string.id };
    templates.add(r.string.finding.split(A).join('@').split(B).join('@'));
  }
  assert.ok(templates.size >= 8, `expected variety across 60 pairs, saw ${templates.size} templates`);
  const g = (await H.getWall(s, last.w)).body;
  assert.equal(g.strings[0].finding, last.finding);
  assert.equal(g.strings[0].id, last.id);
});
