'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('../lib/preflight');

const sandboxed = { sandbox: { enabled: true } };
const tools = (have) => (name) => have.includes(name);
const trusted = (dir) => ({ projects: { [dir]: { hasTrustDialogAccepted: true } } });

test('no warnings when the sandbox tools exist and the workspace is trusted', () => {
  const r = preflight({ settings: sandboxed, claudeJson: trusted('/p'), hasTool: tools(['bwrap', 'socat']), projectDir: '/p' });
  assert.deepEqual(r, { warnings: [], errors: [] });
});

test('warns when the sandbox is enabled in settings but bwrap or socat is missing', () => {
  const r = preflight({ settings: sandboxed, claudeJson: trusted('/p'), hasTool: tools(['socat']), projectDir: '/p' });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /sandbox/i);
  assert.match(r.warnings[0], /bwrap/);
});

test('--require-sandbox turns the missing sandbox into an error', () => {
  const r = preflight({ settings: sandboxed, claudeJson: trusted('/p'), hasTool: tools([]), projectDir: '/p', requireSandbox: true });
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.warnings, []);
});

test('a sandbox that settings never enabled is not reported', () => {
  const r = preflight({ settings: {}, claudeJson: trusted('/p'), hasTool: tools([]), projectDir: '/p' });
  assert.deepEqual(r, { warnings: [], errors: [] });
});

test('warns that the allow list is ignored when the workspace is not recorded as trusted', () => {
  for (const claudeJson of [null, {}, { projects: {} }, { projects: { '/p': { hasTrustDialogAccepted: false } } }]) {
    const r = preflight({ settings: {}, claudeJson, hasTool: tools([]), projectDir: '/p' });
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /trust/i);
    assert.match(r.warnings[0], /allow/i);
  }
});

test('a trusted parent directory counts as trusted', () => {
  const r = preflight({ settings: {}, claudeJson: trusted('/work'), hasTool: tools([]), projectDir: '/work/app' });
  assert.deepEqual(r.warnings, []);
});
