'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readState, writeState, buildState } = require('../lib/state');
const { runVerify } = require('../lib/verify');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));

test('readState returns null when no run was ever initialised', () => {
  assert.equal(readState(tmp()), null);
});

test('state round-trips through disk', () => {
  const dir = tmp();
  const state = buildState({ verifyCommand: 'true', task: 't' });
  writeState(dir, state);
  assert.deepEqual(readState(dir), state);
});

test('readState throws a clear error on corrupt state instead of silently disabling the run', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{nope');
  assert.throws(() => readState(dir), /state\.json/);
});

test('buildState applies defaults and rejects an empty verify command', () => {
  const s = buildState({ verifyCommand: 'npm test' });
  assert.equal(s.maxIterations, 20);
  assert.equal(s.stallLimit, 3);
  assert.equal(s.active, true);
  assert.throws(() => buildState({ verifyCommand: '  ' }), /verify/i);
});

test('runVerify reports pass, fail and timeout', async () => {
  const dir = tmp();
  assert.equal((await runVerify('echo hi', { cwd: dir, timeoutMs: 5000 })).pass, true);
  const failed = await runVerify('echo boom >&2; exit 3', { cwd: dir, timeoutMs: 5000 });
  assert.equal(failed.pass, false);
  assert.match(failed.output, /boom/);
  const slow = await runVerify('sleep 5', { cwd: dir, timeoutMs: 200 });
  assert.equal(slow.pass, false);
  assert.equal(slow.timedOut, true);
});

test('runVerify kills grandchildren that hold the output pipe open', async () => {
  const started = Date.now();
  const r = await runVerify('(sleep 30 &) ; sleep 30', { cwd: tmp(), timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 5000, 'returned promptly instead of waiting for the grandchild');
});

test('buildState normalises protected paths and defaults the commit gate on', () => {
  const s = buildState({ verifyCommand: 'true', protectedPaths: ['./tests/', 'acceptance/'] });
  assert.deepEqual(s.protectedPaths, ['tests/', 'acceptance/', 'verify.config.json', 'spec.md']);
  assert.equal(s.commitGate, true);
  assert.equal(buildState({ verifyCommand: 'true', commitGate: false }).commitGate, false);
});

test('buildState records the task file and the checkpoint settings', () => {
  const s = buildState({ verifyCommand: 'true', task: 't', taskFile: 'spec.md', checkpointPush: true });
  assert.equal(s.taskFile, 'spec.md');
  assert.equal(s.checkpoint, true);
  assert.equal(s.checkpointPush, true);
  const d = buildState({ verifyCommand: 'true' });
  assert.equal(d.checkpoint, true);
  assert.equal(d.checkpointPush, false);
  assert.equal(buildState({ verifyCommand: 'true', checkpoint: false }).checkpoint, false);
});

test('buildState defaults diagnosis on and normalises hidden paths (inside the project or absolute outside it)', () => {
  assert.equal(buildState({ verifyCommand: 'true' }).diagnose, true);
  assert.equal(buildState({ verifyCommand: 'true', diagnose: false }).diagnose, false);
  const s = buildState({ verifyCommand: 'true', protectedPaths: ['acceptance/'], hiddenPaths: ['./holdout/', '/srv/secret-holdout'], projectDir: '/p' });
  assert.deepEqual(s.hiddenPaths, ['/p/holdout', '/srv/secret-holdout']);
  assert.ok(s.protectedPaths.includes('holdout/'), 'a hidden path inside the project is also read-only');
});

test('buildState records the wall-clock budget and no-progress limit', () => {
  const s = buildState({ verifyCommand: 'true', maxMinutes: 60, noProgressLimit: 3, startedAt: 123 });
  assert.equal(s.maxMinutes, 60);
  assert.equal(s.noProgressLimit, 3);
  assert.equal(s.startedAt, 123);
  const d = buildState({ verifyCommand: 'true' });
  assert.equal(d.maxMinutes, null);
  assert.equal(d.noProgressLimit, null);
});

test('buildState always protects the gate files, without duplicating explicit entries', () => {
  const s = buildState({ verifyCommand: 'true' });
  assert.deepEqual(s.protectedPaths, ['verify.config.json', 'acceptance/', 'spec.md']);
});

test('buildState records the verify timeout and lint command, and rejects a bad timeout', () => {
  const s = buildState({ verifyCommand: 'true', verifyTimeoutMs: 90_000, lintCommand: 'npm run lint' });
  assert.equal(s.verifyTimeoutMs, 90_000);
  assert.equal(s.lintCommand, 'npm run lint');
  assert.throws(() => buildState({ verifyCommand: 'true', verifyTimeoutMs: 0 }), /timeout/i);
});
