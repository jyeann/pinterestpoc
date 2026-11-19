'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCandidates, parseCost, summarise, pickBest, runTune } = require('../lib/tune');

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

test('parseCandidates reads model:effort pairs and rejects unknown effort levels', () => {
  assert.deepEqual(parseCandidates('claude-opus-5-5:low, claude-sonnet-5-5:high'), [
    { model: 'claude-opus-5-5', effort: 'low' }, { model: 'claude-sonnet-5-5', effort: 'high' },
  ]);
  assert.throws(() => parseCandidates('m:turbo'), /effort/i);
  assert.throws(() => parseCandidates('justmodel'), /model:effort/);
  assert.throws(() => parseCandidates(''), /candidate/i);
});

test('parseCost finds total_cost_usd in claude --output-format json output, else null', () => {
  assert.equal(parseCost('noise\n{"type":"result","total_cost_usd":0.42,"x":1}\n'), 0.42);
  assert.equal(parseCost('no json here'), null);
});

test('summarise averages cost and time and computes the pass rate per candidate', () => {
  const s = summarise({ model: 'm', effort: 'low' }, [
    { pass: true, costUsd: 1, seconds: 10 }, { pass: false, costUsd: 3, seconds: 30 },
  ]);
  assert.equal(s.passRate, 0.5);
  assert.equal(s.meanCostUsd, 2);
  assert.equal(s.meanSeconds, 20);
});

test('pickBest takes the cheapest candidate that meets the pass-rate bar; falls back to time when cost is unknown', () => {
  const rows = [
    { model: 'a', effort: 'high', passRate: 1, meanCostUsd: 5, meanSeconds: 5 },
    { model: 'b', effort: 'low', passRate: 1, meanCostUsd: 2, meanSeconds: 50 },
    { model: 'c', effort: 'low', passRate: 0.5, meanCostUsd: 1, meanSeconds: 1 },
  ];
  assert.equal(pickBest(rows, 1).model, 'b');
  assert.equal(pickBest(rows, 0.5).model, 'c');
  assert.equal(pickBest([{ model: 'x', effort: 'low', passRate: 0, meanCostUsd: 1, meanSeconds: 1 }], 1), null);
  const noCost = [{ model: 'p', passRate: 1, meanCostUsd: null, meanSeconds: 9 }, { model: 'q', passRate: 1, meanCostUsd: null, meanSeconds: 3 }];
  assert.equal(pickBest(noCost, 1).model, 'q');
});

test('runTune runs each candidate in its own worktree, verifies it, and leaves the real repo untouched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tune-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'spec.md'), 'make done.txt');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  const agentCmd = 'if [ "$HARNESS_EFFORT" = low ]; then echo ok > done.txt; echo \'{"total_cost_usd":0.5}\'; else echo \'{"total_cost_usd":2}\'; fi';
  const report = await runTune(dir, {
    candidates: [{ model: 'm', effort: 'low' }, { model: 'm', effort: 'high' }],
    verifyCommand: 'test -f done.txt', taskText: 'make done.txt', agentCmd, trials: 1, minPassRate: 1,
  });
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].passRate, 1);
  assert.equal(report.results[0].meanCostUsd, 0.5);
  assert.equal(report.results[1].passRate, 0);
  assert.equal(report.best.effort, 'low');
  assert.equal(fs.existsSync(path.join(dir, 'done.txt')), false, 'real worktree untouched');
  assert.equal(git(dir, 'worktree', 'list').split('\n').length, 1, 'temporary worktrees removed');
});

test('runTune refuses a non-git directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tune-nogit-'));
  await assert.rejects(runTune(dir, { candidates: [{ model: 'm', effort: 'low' }], verifyCommand: 'true', taskText: 't', agentCmd: 'true', trials: 1, minPassRate: 1 }), /git/i);
});

const { parseUsage } = require('../lib/tune');

test('parseUsage reads token counts and turns from claude --output-format json, else null', () => {
  const out = 'x\n{"type":"result","num_turns":7,"total_cost_usd":1.5,"usage":{"input_tokens":100,"output_tokens":2000,"cache_read_input_tokens":50000,"cache_creation_input_tokens":3000}}\n';
  assert.deepEqual(parseUsage(out), { turns: 7, input: 100, output: 2000, cacheRead: 50000, cacheCreate: 3000 });
  assert.equal(parseUsage('nothing'), null);
});

test('summarise averages tokens and derives the cache hit ratio', () => {
  const u = (input, output, cacheRead, cacheCreate, turns) => ({ input, output, cacheRead, cacheCreate, turns });
  const s = summarise({ model: 'm', effort: 'low' }, [
    { pass: true, costUsd: 1, seconds: 1, usage: u(100, 1000, 8000, 1900, 4) },
    { pass: true, costUsd: 1, seconds: 1, usage: u(100, 3000, 8000, 1900, 6) },
  ]);
  assert.equal(s.meanOutputTokens, 2000);
  assert.equal(s.meanTurns, 5);
  assert.equal(Math.round(s.cacheHitRatio * 100), 80);
});

test('summarise leaves token fields null when usage was not reported', () => {
  const s = summarise({ model: 'm', effort: 'low' }, [{ pass: true, costUsd: null, seconds: 1, usage: null }]);
  assert.equal(s.meanOutputTokens, null);
  assert.equal(s.cacheHitRatio, null);
});
