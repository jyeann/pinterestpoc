'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.join(__dirname, '..', 'hooks');
const CLI = path.join(__dirname, '..', 'bin', 'harness.js');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-e2e-'));
const run = (script, projectDir, event) => spawnSync('node', [script], {
  input: JSON.stringify(event),
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
});
const cli = (projectDir, ...args) => spawnSync('node', [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
});
const bash = (projectDir, command) => run(path.join(HOOKS, 'pre-bash.js'), projectDir, { tool_name: 'Bash', tool_input: { command } });
const stop = (projectDir) => run(path.join(HOOKS, 'stop.js'), projectDir, { hook_event_name: 'Stop' });
const state = (dir) => JSON.parse(fs.readFileSync(path.join(dir, '.harness', 'state.json'), 'utf8'));

test('pre-bash exits 2 with a reason for a blocked command', () => {
  const r = bash(project(), 'git push --force origin x');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BLOCKED/);
});

test('pre-bash allows an ordinary command', () => {
  assert.equal(bash(project(), 'ls -la').status, 0);
});

test('pre-bash fails open (exit 1, not 2) when its input is malformed', () => {
  const r = spawnSync('node', [path.join(HOOKS, 'pre-bash.js')], { input: '{bad', encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('stop hook is inert when no run was started', () => {
  const r = stop(project());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop hook blocks while verify fails, then releases once it passes', () => {
  const dir = project();
  assert.equal(cli(dir, 'init', '--verify', 'test -f done.txt', '--max', '5').status, 0);

  const first = stop(dir);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.equal(state(dir).iteration, 1);

  fs.writeFileSync(path.join(dir, 'done.txt'), 'x');
  const second = stop(dir);
  assert.equal(second.stdout, '');
  assert.equal(state(dir).status, 'passed');
  assert.equal(state(dir).active, false);
});

test('stop hook halts at the iteration cap instead of looping forever', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'echo "fail $RANDOM" >&2; false', '--max', '2', '--stall', '99');
  const decisions = [stop(dir), stop(dir), stop(dir), stop(dir)].map((r) => r.stdout);
  assert.equal(JSON.parse(decisions[0]).decision, 'block');
  assert.equal(JSON.parse(decisions[1]).decision, 'block');
  assert.match(JSON.parse(decisions[2]).reason, /diagnosis/i, 'one bounded diagnosis turn at the cap');
  assert.equal(decisions[3], '');
  assert.equal(state(dir).status, 'halted-max-iterations');
});

test('commit gate refuses git commit while verify fails and allows it once green', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'test -f ok.txt');
  const refused = bash(dir, 'git commit -m wip');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /Commit refused/);
  fs.writeFileSync(path.join(dir, 'ok.txt'), 'x');
  assert.equal(bash(dir, 'git commit -m done').status, 0);
});

test('while a run is active, pre-write protects acceptance paths and pre-bash blocks `off`', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--protect', 'acceptance/');
  const edit = run(path.join(HOOKS, 'pre-write.js'), dir, {
    tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'acceptance', 't.js'), new_string: 'x' },
  });
  assert.equal(edit.status, 2);
  assert.equal(bash(dir, `node .claude/harness/bin/harness.js off`).status, 2);
});

test('cli rejects bad input with a clear message', () => {
  const dir = project();
  const noVerify = cli(dir, 'init');
  assert.equal(noVerify.status, 2);
  assert.match(noVerify.stderr, /verify/i);
  assert.equal(cli(dir, 'init', '--verify', 'true', '--max', '0').status, 2);
});

test('cli off deactivates and status reports it', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true');
  cli(dir, 'off');
  assert.equal(state(dir).active, false);
  assert.match(cli(dir, 'status').stdout, /stopped-by-human/);
});

test('--no-commit-gate lets checkpoint commits through while verify fails', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'false', '--no-commit-gate');
  assert.equal(bash(dir, 'git commit -m wip').status, 0);
});

test('corrupt state keeps guards on and refuses commits instead of failing open', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.harness'));
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{broken');
  assert.equal(bash(dir, 'git push --force origin x').status, 2);
  const commit = bash(dir, 'git commit -m x');
  assert.equal(commit.status, 2);
  assert.match(commit.stderr, /corrupt/i);
});

test('a bare git push on main is refused using the real current branch', () => {
  const dir = project();
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  assert.equal(bash(dir, 'git push').status, 2);
  spawnSync('git', ['checkout', '-q', '-b', 'claude/feat'], { cwd: dir });
  assert.equal(bash(dir, 'git push').status, 0);
});

const { execFileSync } = require('node:child_process');
const gitIn = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('stop hook checkpoints uncommitted work on every blocked stop while the commit gate stays on', () => {
  const dir = project();
  gitIn(dir, 'init', '-q', '-b', 'feature');
  gitIn(dir, 'config', 'user.email', 't@example.com');
  gitIn(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'seed.txt'), 's');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-qm', 'init');
  cli(dir, 'init', '--verify', 'exit 1', '--task', 'build it');
  fs.writeFileSync(path.join(dir, 'wip.txt'), 'half done');

  const r = stop(dir);
  assert.match(r.stdout, /"decision":"block"/);
  assert.equal(gitIn(dir, 'show', 'refs/harness/wip/feature:wip.txt'), 'half done');
  assert.equal(gitIn(dir, 'log', '--oneline').split('\n').length, 1, 'no commit on the branch');
  assert.equal(bash(dir, 'git commit -m "wip"').status, 2, 'commit gate still refuses');
});

test('stop hook does not checkpoint when --no-checkpoint is set', () => {
  const dir = project();
  gitIn(dir, 'init', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  cli(dir, 'init', '--verify', 'exit 1', '--no-checkpoint');
  stop(dir);
  assert.equal(gitIn(dir, 'for-each-ref', 'refs/harness/'), '');
});

test('end to end: a stalled run gets one diagnosis turn, then is halted with the report noted', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'echo "✖ creates todo (3ms)"; echo "  AssertionError: Expected 200 !== 201"; exit 1', '--stall', '2', '--no-checkpoint');
  assert.match(stop(dir).stdout, /"decision":"block"/);
  const diag = stop(dir);
  assert.match(diag.stdout, /IMPL_BUG/);
  assert.equal(state(dir).diagnosing, 'halted-stalled');
  fs.writeFileSync(path.join(dir, 'HARNESS-DIAGNOSIS.md'), '# diagnosis\nIMPL_BUG');
  const end = stop(dir);
  assert.equal(end.stdout, '');
  assert.equal(state(dir).status, 'halted-stalled');
  assert.equal(state(dir).diagnosis, 'written');
  assert.equal(state(dir).active, false);
});

test('a stale diagnosis file from an earlier run does not count', () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'HARNESS-DIAGNOSIS.md'), 'old');
  cli(dir, 'init', '--verify', 'exit 1', '--stall', '1', '--no-checkpoint');
  stop(dir);
  stop(dir);
  assert.equal(state(dir).diagnosis, 'missing');
});

test('--no-diagnosis halts immediately', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'exit 1', '--stall', '1', '--no-checkpoint', '--no-diagnosis');
  stop(dir);
  assert.equal(state(dir).status, 'halted-stalled');
});

test('pre-read blocks a hidden path and allows others', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--hide', 'holdout/', '--no-checkpoint');
  const read = (file_path) => run(path.join(HOOKS, 'pre-read.js'), dir, { tool_name: 'Read', tool_input: { file_path } });
  assert.equal(read(path.join(dir, 'holdout', 'a.js')).status, 2);
  assert.equal(read(path.join(dir, 'src', 'a.js')).status, 0);
});

test('--max-minutes and --no-progress are accepted and stored; an expired budget halts the run', () => {
  const dir = project();
  const init = cli(dir, 'init', '--verify', 'exit 1', '--max-minutes', '30', '--no-progress', '4', '--no-checkpoint', '--no-diagnosis');
  assert.equal(init.status, 0, init.stderr);
  assert.equal(state(dir).maxMinutes, 30);
  assert.equal(state(dir).noProgressLimit, 4);
  const file = path.join(dir, '.harness', 'state.json');
  fs.writeFileSync(file, JSON.stringify({ ...state(dir), startedAt: Date.now() - 31 * 60_000 }));
  stop(dir);
  assert.equal(state(dir).status, 'halted-time');
});

test('init rejects a non-positive --max-minutes', () => {
  assert.equal(cli(project(), 'init', '--verify', 'true', '--max-minutes', '0').status, 2);
});

const edit = (projectDir, event = {}) => run(path.join(HOOKS, 'post-edit.js'), projectDir, { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'a.js' }, ...event });

test('stop hook fails closed once when the state file is corrupt, then lets the session end', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true');
  fs.writeFileSync(path.join(dir, '.harness', 'state.json'), '{bad');
  const first = run(path.join(HOOKS, 'stop.js'), dir, { hook_event_name: 'Stop' });
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.match(JSON.parse(first.stdout).reason, /corrupt/i);
  const second = run(path.join(HOOKS, 'stop.js'), dir, { hook_event_name: 'Stop', stop_hook_active: true });
  assert.equal(second.stdout, '');
});

test('init --verify-timeout bounds the verify command', () => {
  const dir = project();
  assert.equal(cli(dir, 'init', '--verify', 'sleep 20', '--verify-timeout', '1').status, 0);
  const started = Date.now();
  const r = cli(dir, 'verify');
  assert.match(r.stdout, /timed out/);
  assert.ok(Date.now() - started < 10_000);
});

test('post-edit hook is inert without a lint command', () => {
  const r = edit(project());
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
});

test('post-edit hook exits 2 with the lint output when lint fails, 0 when it passes', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--lint', 'echo "bad style" >&2; false');
  const failed = edit(dir);
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /bad style/);
  cli(dir, 'off');
  cli(dir, 'init', '--verify', 'true', '--lint', 'true');
  assert.equal(edit(dir).status, 0);
});

test('post-edit hook ignores edits when the run is not active', () => {
  const dir = project();
  cli(dir, 'init', '--verify', 'true', '--lint', 'false');
  cli(dir, 'off');
  assert.equal(edit(dir).status, 0);
});

test('init warns about an untrusted workspace but still starts the run', () => {
  const dir = project();
  const r = cli(dir, 'init', '--verify', 'true');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING.*trust/i);
  assert.equal(state(dir).active, true);
});

test('init --require-sandbox refuses to start when settings enable a sandbox that cannot run', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ sandbox: { enabled: true } }));
  const noTools = { ...process.env, PATH: '/nonexistent', CLAUDE_PROJECT_DIR: dir };
  const r = spawnSync(process.execPath, [CLI, 'init', '--verify', 'true', '--require-sandbox'], { encoding: 'utf8', env: noTools });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /bwrap/);
  assert.equal(fs.existsSync(path.join(dir, '.harness', 'state.json')), false);
});
