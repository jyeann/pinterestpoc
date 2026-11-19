'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveStatic, serveStatic, MIME } = require('../src/static');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-static-'));
const pub = path.join(root, 'public');
fs.mkdirSync(pub);
fs.writeFileSync(path.join(pub, 'a.js'), 'console.log(1)');
fs.writeFileSync(path.join(pub, 'b.css'), 'body{}');
fs.writeFileSync(path.join(pub, 'index.html'), '<p>hi</p>');
fs.writeFileSync(path.join(pub, 'x.svg'), '<svg/>');
fs.writeFileSync(path.join(pub, 'f.ico'), 'ico');
fs.writeFileSync(path.join(pub, 'secret.txt'), 'nope');
fs.writeFileSync(path.join(pub, '.env'), 'KEY=1');
fs.mkdirSync(path.join(pub, 'dir.js'));
fs.writeFileSync(path.join(root, 'outside.js'), 'outside');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function fakeRes() {
  const res = { status: null, headers: {}, body: null };
  res.writeHead = (s, h) => { res.status = s; res.headers = h; };
  res.end = (b) => { res.body = b.toString('utf8'); };
  return res;
}

test('MIME map covers exactly html, js, css, svg, ico', () => {
  assert.deepEqual(Object.keys(MIME).sort(), ['.css', '.html', '.ico', '.js', '.svg']);
});

test('resolveStatic accepts plain names and decodes percent escapes of safe characters', () => {
  const r = resolveStatic(pub, 'a.js');
  assert.equal(r.file, path.join(pub, 'a.js'));
  assert.match(r.type, /javascript/);
  assert.match(resolveStatic(pub, 'b.css').type, /css/);
  assert.match(resolveStatic(pub, 'index.html').type, /^text\/html/);
  assert.equal(resolveStatic(pub, 'x.svg').type, 'image/svg+xml');
  assert.ok(resolveStatic(pub, 'f.ico'));
  assert.equal(resolveStatic(pub, '%61.js').file, path.join(pub, 'a.js'));
  assert.match(resolveStatic(pub, 'A.JS').type, /javascript/);
});

test('resolveStatic refuses traversal, encodings of it, absolute paths, separators and odd names', () => {
  const bad = [
    '', '.', '..', '...', '../package.json', '..%2fpackage.json', '%2e%2e%2fpackage.json', '%2e%2e', '%2E%2E/x.js',
    '..\\package.json', '/etc/passwd', '/a.js', 'sub/a.js', 'a.js/', 'a b.js', 'a.js%00', '%00', '%zz', 'é.js', '%c3%a9.js',
    'secret.txt', 'a', '.env', 'a.js\n', 'a.js;', 'a.js?x', undefined, null,
  ];
  for (const name of bad) assert.equal(resolveStatic(pub, name), null, JSON.stringify(name));
});

test('serveStatic sends the file with type, length and returns true; missing files and directories return false', async () => {
  const ok = fakeRes();
  assert.equal(await serveStatic(ok, pub, 'a.js'), true);
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'console.log(1)');
  assert.match(ok.headers['Content-Type'], /javascript/);
  assert.equal(ok.headers['Content-Length'], 14);
  const html = fakeRes();
  assert.equal(await serveStatic(html, pub, 'index.html'), true);
  assert.match(html.headers['Content-Type'], /text\/html/);
  for (const name of ['missing.js', 'dir.js', '../outside.js', '%2e%2e%2foutside.js', 'secret.txt']) {
    const res = fakeRes();
    assert.equal(await serveStatic(res, pub, name), false, name);
    assert.equal(res.status, null);
  }
});
