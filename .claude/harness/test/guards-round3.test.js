'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkBash, impliesBulkStaging, secretPathsInStatus } = require('../lib/guards');

const idle = { active: false, protectedPaths: [], projectDir: '/p' };
const blocked = (cmd, ctx = idle) => assert.equal(checkBash(cmd, ctx).block, true, `should block: ${cmd}`);
const allowed = (cmd, ctx = idle) => assert.equal(checkBash(cmd, ctx).block, false, `should allow: ${cmd}`);

test('git clean that can delete ignored or untracked files is blocked; dry run is fine', () => {
  for (const cmd of ['git clean -fdx', 'git clean -f', 'git clean -xdf', 'git clean --force']) blocked(cmd);
  allowed('git clean -n');
  allowed('git clean --dry-run');
});

test('deleting, renaming or force-moving a protected branch is blocked', () => {
  for (const cmd of ['git branch -D main', 'git branch -d master', 'git branch -M main', 'git branch -f main HEAD~1', 'git branch --delete main']) blocked(cmd);
  blocked('git branch -D feat/x'); // any force-delete loses unmerged work, so it is blocked on every branch
  for (const cmd of ['git branch', 'git branch feat/y', 'git branch -d feat/x']) allowed(cmd);
});

test('hook bypass by config or environment is blocked, mentioning it in text is not', () => {
  for (const cmd of ['git -c core.hooksPath=/dev/null commit -m x', 'git config core.hooksPath /tmp/h', 'HUSKY=0 git commit -m x', 'GIT_CONFIG_COUNT=1 git commit -m x']) blocked(cmd);
  for (const cmd of ['HUSKY=1 npm test', 'git commit -m "docs: explain core.hooksPath"']) allowed(cmd);
});

test('killing node, the verifier or the harness is blocked', () => {
  for (const cmd of ['pkill -f verify', 'pkill node', 'killall node', 'kill $(pgrep harness)']) blocked(cmd);
  allowed('kill 1234');
  allowed('pkill -f webpack');
});

test('a clobbering redirect (>|) into a protected path is a write, not a pipe', () => {
  const live = { active: true, protectedPaths: ['acceptance/'], projectDir: '/p' };
  blocked('echo x >| acceptance/a.test.js', live);
  blocked('echo x >|acceptance/a.test.js', live);
  allowed('echo x >| out.txt', live);
  allowed('ls | grep x', live);
});

test('bulk staging is detected only for implicit forms', () => {
  for (const cmd of ['git add -A', 'git add .', 'git add --all', 'git add -u', 'git commit -a -m x', 'git commit -am x', 'git add -vA']) assert.equal(impliesBulkStaging(cmd), true, cmd);
  for (const cmd of ['git add src/a.js', 'git commit -m "msg -a"', 'git status', 'ls -a']) assert.equal(impliesBulkStaging(cmd), false, cmd);
});

test('secret file names are picked out of git status output', () => {
  const status = ['?? .env', ' M src/a.js', '?? .env.example', 'A  keys/server.pem'].join('\0');
  assert.deepEqual(secretPathsInStatus(status), ['.env', 'keys/server.pem']);
  assert.deepEqual(secretPathsInStatus(''), []);
});

test('pre-bash refuses git add -A while an unignored .env exists, and allows it once ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stage-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  const hook = path.join(__dirname, '..', 'hooks', 'pre-bash.js');
  const bash = (command) => spawnSync('node', [hook], { input: JSON.stringify({ session_id: 'g', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const refused = bash('git add -A');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /\.env/);
  assert.equal(bash('git add a.js').status, 0);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
  assert.equal(bash('git add -A').status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'traces', 'g.jsonl'), 'utf8').split('\n')[0]).type, 'blocked');
});
