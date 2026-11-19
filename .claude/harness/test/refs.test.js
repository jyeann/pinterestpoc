'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkRefs } = require('../lib/refs');

const CLI = path.join(__dirname, '..', 'bin', 'check-refs.js');
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refs-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('this repository has no dangling references (CI guard after upstream syncs)', () => {
  assert.deepEqual(checkRefs(path.join(__dirname, '..', '..')), []);
});

test('missing script, skill, rules dir, agent, plugin prefix and removed command are all reported', () => {
  const dir = fixture({
    'commands/a.md': 'Run `node scripts/tool.js`.\nSee `skills/ghost/` and `rules/react/x.md`.\nAgent(subagent_type: "nobody")\nuse ecc:planner\n- `/evolve` clusters things\n',
    'agents/real.md': 'ok\n',
    'skills/real/SKILL.md': 'See `skills/real/` and Agent(subagent_type: "real") and Agent(subagent_type: "Explore").\n',
    'rules/ecc-common/r.md': 'see rules/ecc-common/r.md\n',
  });
  const found = checkRefs(dir).join('\n');
  for (const needle of ['missing script scripts/tool.js', 'missing skill ghost', 'missing rules dir react', 'missing agent nobody', 'plugin-scoped name ecc:planner', 'missing command /evolve']) {
    assert.match(found, new RegExp(needle.replace(/[/.]/g, '\\$&')));
  }
  assert.doesNotMatch(found, /skills\/real|missing agent real|Explore/);
});

test('urls, allowed optional scripts and existing targets are not reported', () => {
  const dir = fixture({
    'skills/s/SKILL.md': 'See https://github.com/x/skills/tree/abc/\nnode scripts/hooks/suggest-compact.js\n',
    'commands/c.md': 'Uses `skills/s/`.\n',
  });
  assert.deepEqual(checkRefs(dir), []);
});

test('CLI exits 0 when clean and 1 with a list when not', () => {
  const clean = spawnSync('node', [CLI, fixture({ 'commands/c.md': 'fine\n' })], { encoding: 'utf8' });
  assert.equal(clean.status, 0);
  const dirty = spawnSync('node', [CLI, fixture({ 'commands/c.md': 'see skills/ghost/\n' })], { encoding: 'utf8' });
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /ghost/);
  assert.equal(spawnSync('node', [CLI], { encoding: 'utf8' }).status, 0);
});
