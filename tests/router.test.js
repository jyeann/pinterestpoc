'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRouter, pathnameOf, ID_RE } = require('../src/router');

const routes = [
  { method: 'GET', path: '/', name: 'home' },
  { method: 'POST', path: '/api/walls', name: 'create' },
  { method: 'GET', path: '/api/walls/:id', name: 'get' },
  { method: 'PATCH', path: '/api/walls/:id', name: 'patch' },
  { method: 'DELETE', path: '/api/walls/:id/pins/:pid', name: 'delpin' },
  { method: 'GET', path: '/w/:id', name: 'shell' },
  { method: 'GET', path: '/w/:id/', name: 'shell2' },
  { method: 'GET', path: '/static/*', name: 'static' },
];
const r = createRouter(routes);

test('matches method and path and extracts params', () => {
  const m = r.resolve('GET', '/api/walls/abc123');
  assert.equal(m.type, 'match');
  assert.equal(m.route.name, 'get');
  assert.deepEqual(m.params, { id: 'abc123' });
  const d = r.resolve('DELETE', '/api/walls/w1/pins/p-9_x');
  assert.equal(d.route.name, 'delpin');
  assert.deepEqual(d.params, { id: 'w1', pid: 'p-9_x' });
  assert.equal(r.resolve('GET', '/').route.name, 'home');
});

test('same path, different method picks the right route', () => {
  assert.equal(r.resolve('PATCH', '/api/walls/x').route.name, 'patch');
  assert.equal(r.resolve('GET', '/api/walls/x').route.name, 'get');
});

test('known path with the wrong method is method_not_allowed with every allowed method', () => {
  assert.deepEqual(r.resolve('GET', '/api/walls'), { type: 'method_not_allowed', allow: ['POST'] });
  const m = r.resolve('PUT', '/api/walls/x');
  assert.equal(m.type, 'method_not_allowed');
  assert.deepEqual(m.allow, ['GET', 'PATCH']);
});

test('unknown paths are not_found', () => {
  for (const p of ['/nope', '/api', '/api/walls/x/unknown', '/api/walls/', '/api/walls/x/', '/w', '/w/x/y/z', '']) {
    assert.deepEqual(r.resolve('GET', p), { type: 'not_found' }, p);
  }
});

test('id params must match ^[A-Za-z0-9_-]{1,32}$, else not_found', () => {
  assert.equal(r.resolve('GET', `/api/walls/${'a'.repeat(32)}`).type, 'match');
  assert.equal(r.resolve('GET', `/api/walls/${'a'.repeat(33)}`).type, 'not_found');
  for (const bad of ['a.b', 'a%20b', 'a b', 'é', '..']) {
    assert.equal(r.resolve('GET', `/api/walls/${bad}`).type, 'not_found', bad);
    assert.equal(r.resolve('DELETE', `/api/walls/${bad}`).type, 'not_found', bad);
  }
  assert.ok(ID_RE.test('A-z_0'));
  assert.ok(!ID_RE.test(''));
});

test('trailing slash is distinct: /w/:id and /w/:id/ are both routes', () => {
  assert.equal(r.resolve('GET', '/w/abc').route.name, 'shell');
  assert.equal(r.resolve('GET', '/w/abc/').route.name, 'shell2');
});

test('wildcard captures the rest, including empty and nested', () => {
  assert.deepEqual(r.resolve('GET', '/static/wall.js').params, { rest: 'wall.js' });
  assert.deepEqual(r.resolve('GET', '/static/').params, { rest: '' });
  assert.deepEqual(r.resolve('GET', '/static/a/b').params, { rest: 'a/b' });
  assert.deepEqual(r.resolve('GET', '/static//etc/passwd').params, { rest: '/etc/passwd' });
  assert.equal(r.resolve('POST', '/static/x').type, 'method_not_allowed');
  assert.equal(r.resolve('GET', '/static').type, 'not_found');
});

test('pathnameOf strips the query and fragment and nothing else', () => {
  assert.equal(pathnameOf('/a/b?x=1'), '/a/b');
  assert.equal(pathnameOf('/a#frag'), '/a');
  assert.equal(pathnameOf('/static/..%2fx'), '/static/..%2fx');
  assert.equal(pathnameOf('/'), '/');
});
