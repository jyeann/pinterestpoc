'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkBash, checkRead } = require('../lib/guards');

const HIDDEN = '/srv/held-out/sheet';
const live = { active: true, protectedPaths: [], projectDir: '/p', hiddenDir: HIDDEN };
const idle = { ...live, active: false };
const blocked = (cmd, ctx = live) => assert.equal(checkBash(cmd, ctx).block, true, `should block: ${cmd}`);
const allowed = (cmd, ctx = live) => assert.equal(checkBash(cmd, ctx).block, false, `should allow: ${cmd}`);

test('held-out tests cannot be named or listed from the shell during a run', () => {
  for (const cmd of [
    `cat ${HIDDEN}/a.test.js`, `ls ${HIDDEN}`, `grep -r foo ${HIDDEN}`, `cp ${HIDDEN}/a.test.js /tmp/x`,
    'echo $HARNESS_HIDDEN_DIR', 'ls "$HARNESS_HIDDEN_DIR"', 'printenv HARNESS_HIDDEN_DIR', 'bash -c "cat $HARNESS_HIDDEN_DIR/*"',
    `node -e "require('fs').readdirSync('${HIDDEN}')"`,
  ]) blocked(cmd);
});

test('ordinary commands, including the verify gate, still work', () => {
  for (const cmd of ['node .claude/harness/bin/verify.js --fast', 'node --test "tests/*.test.js"', 'ls /srv/held-out-notes', 'cat src/index.js']) allowed(cmd);
});

test('the held-out guard is inert when no run is active or no hidden dir is configured', () => {
  allowed(`cat ${HIDDEN}/a.test.js`, idle);
  allowed(`cat ${HIDDEN}/a.test.js`, { ...live, hiddenDir: null });
});

test('Read, Grep and Glob cannot reach the held-out dir by path, pattern or env name', () => {
  const ev = (tool_name, tool_input) => ({ tool_name, tool_input });
  for (const e of [
    ev('Read', { file_path: `${HIDDEN}/a.test.js` }),
    ev('Grep', { pattern: 'x', path: HIDDEN }),
    ev('Grep', { pattern: 'x', path: `${HIDDEN}/sub`, glob: '*.js' }),
    ev('Glob', { pattern: `${HIDDEN}/**/*.js` }),
    ev('Glob', { pattern: '*.js', path: HIDDEN }),
    ev('Read', { file_path: '../../srv/held-out/sheet/a.test.js' }),
    ev('Grep', { pattern: 'HARNESS_HIDDEN_DIR' }),
  ]) assert.equal(checkRead(e, live, '/p').block, true, JSON.stringify(e.tool_input));
  for (const e of [ev('Read', { file_path: '/p/src/index.js' }), ev('Grep', { pattern: 'x', path: '/p/src' }), ev('Glob', { pattern: 'src/**/*.js' }), ev('Read', { file_path: `${HIDDEN}-notes/a.md` })]) {
    assert.equal(checkRead(e, live, '/p').block, false, JSON.stringify(e.tool_input));
  }
  assert.equal(checkRead({ tool_name: 'Read', tool_input: { file_path: `${HIDDEN}/a.test.js` } }, idle, '/p').block, false);
});

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function runHook(script, dir, event, env = {}) {
  return spawnSync('node', [path.join(__dirname, '..', 'hooks', script)], {
    input: JSON.stringify(event), encoding: 'utf8', env: { ...cleanEnv, CLAUDE_PROJECT_DIR: dir, ...env },
  });
}
const cli = (dir, ...args) => spawnSync('node', [path.join(__dirname, '..', 'bin', 'harness.js'), ...args], {
  encoding: 'utf8', env: { ...cleanEnv, CLAUDE_PROJECT_DIR: dir },
});

test('pre-read and pre-bash hooks enforce the held-out dir from HARNESS_HIDDEN_DIR only while a run is active', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-proj-'));
  const hidden = fs.mkdtempSync(path.join(os.tmpdir(), 'hidden-tests-'));
  const read = { tool_name: 'Read', tool_input: { file_path: path.join(hidden, 'a.test.js') } };
  const bash = { tool_name: 'Bash', tool_input: { command: `cat ${hidden}/a.test.js` } };
  const env = { HARNESS_HIDDEN_DIR: hidden };

  assert.equal(runHook('pre-read.js', dir, read, env).status, 0, 'no run yet');
  cli(dir, 'init', '--verify', 'true');
  const r = runHook('pre-read.js', dir, read, env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /held-out/i);
  assert.equal(runHook('pre-bash.js', dir, bash, env).status, 2);
  assert.equal(runHook('pre-read.js', dir, read, {}).status, 0, 'without the env var nothing is hidden');
  assert.equal(runHook('pre-read.js', dir, { tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src', 'x.js') } }, env).status, 0);
});
