'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeCheckpoint, restoreCheckpoint, checkpointRef } = require('../lib/checkpoint');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function repo() {
  const dir = tmp('harness-ckpt-');
  git(dir, 'init', '-q', '-b', 'feature');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('checkpoint snapshots uncommitted work on a separate ref and leaves the branch, index and worktree alone', () => {
  const dir = repo();
  const head = git(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'brand new\n');
  const statusBefore = git(dir, 'status', '--porcelain');

  const r = writeCheckpoint(dir, { message: 'iteration 1' });

  assert.equal(r.status, 'created');
  assert.equal(r.ref, checkpointRef('feature'));
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'branch tip unchanged');
  assert.equal(git(dir, 'status', '--porcelain'), statusBefore, 'index and worktree unchanged');
  assert.equal(git(dir, 'show', `${r.ref}:a.txt`), 'two');
  assert.equal(git(dir, 'show', `${r.ref}:new.txt`), 'brand new');
});

test('an unchanged worktree does not create a new checkpoint; a change chains onto the previous one', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  const first = writeCheckpoint(dir, { message: 'i1' });
  assert.equal(writeCheckpoint(dir, { message: 'i2' }).status, 'unchanged');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'three\n');
  const third = writeCheckpoint(dir, { message: 'i3' });
  assert.equal(third.status, 'created');
  assert.equal(git(dir, 'rev-parse', `${third.ref}^`), first.commit);
});

test('never captures harness state, .env files or keys', () => {
  const dir = repo();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{}');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', '.env.local'), 'SECRET=2');
  fs.writeFileSync(path.join(dir, 'id.pem'), 'KEY');
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'fine');
  const r = writeCheckpoint(dir, { message: 'i1' });
  const files = git(dir, 'ls-tree', '-r', '--name-only', r.ref).split('\n');
  assert.ok(files.includes('ok.txt'));
  assert.deepEqual(files.filter((f) => /\.env|\.pem|\.harness/.test(f)), []);
});

test('works on a repo with no commits yet', () => {
  const dir = tmp('harness-ckpt-empty-');
  git(dir, 'init', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  assert.equal(writeCheckpoint(dir, { message: 'i1' }).status, 'created');
});

test('outside a git repo it is skipped, not an error', () => {
  assert.equal(writeCheckpoint(tmp('harness-nogit-'), { message: 'x' }).status, 'skipped');
});

test('restore brings back files lost from the worktree', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'work.txt'), 'important\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
  writeCheckpoint(dir, { message: 'i1' });
  fs.rmSync(path.join(dir, 'work.txt'));
  git(dir, 'checkout', '--', 'a.txt');
  const r = restoreCheckpoint(dir);
  assert.equal(r.status, 'restored');
  assert.equal(fs.readFileSync(path.join(dir, 'work.txt'), 'utf8'), 'important\n');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'edited\n');
});

test('restore reports when there is no checkpoint', () => {
  assert.equal(restoreCheckpoint(repo()).status, 'none');
});

test('opt-in push copies the checkpoint to the remote so it survives losing the sandbox; restore can fetch it', () => {
  const remote = tmp('harness-remote-');
  git(remote, 'init', '-q', '--bare');
  const dir = repo();
  git(dir, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(dir, 'work.txt'), 'important\n');
  const r = writeCheckpoint(dir, { message: 'i1', push: true });
  assert.equal(r.pushed, true);
  assert.ok(git(remote, 'for-each-ref', checkpointRef('feature')).includes(r.commit));

  const fresh = tmp('harness-fresh-');
  git(fresh, 'clone', '-q', remote, '.');
  const result = restoreCheckpoint(fresh, { branch: 'feature' });
  assert.equal(result.status, 'restored');
  assert.equal(fs.readFileSync(path.join(fresh, 'work.txt'), 'utf8'), 'important\n');
});

test('a failing push is reported but never throws', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'work.txt'), 'x');
  const r = writeCheckpoint(dir, { message: 'i1', push: true });
  assert.equal(r.status, 'created');
  assert.equal(r.pushed, false);
});
