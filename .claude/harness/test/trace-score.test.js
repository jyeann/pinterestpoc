'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const trace = require('../lib/trace');
const { scoreSession, efficiency, verifiedBeforeDone, guardrailAttempts } = require('../lib/score');
const { buildReport, renderMarkdown, addMarker } = require('../lib/report');

const HOOK = path.join(__dirname, '..', 'hooks', 'post-tool.js');
const REPORT = path.join(__dirname, '..', 'bin', 'report.js');
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-trace-'));
const tool = (name, summary, ok = true) => ({ type: 'tool', tool: name, summary, ok, sig: trace.signature(name, summary), ts: 1 });
const edit = (file) => tool('Edit', file);
const sh = (cmd, ok = true) => tool('Bash', cmd, ok);

test('a tool event is logged compactly, and a failure event is marked not ok', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm test' } }, 5);
  trace.logToolEvent(dir, { session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' } }, 6);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: { interrupted: true } }, 7);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Read', tool_input: {}, tool_response: { is_error: true } }, 8);
  const [first] = trace.readSessions(dir);
  assert.deepEqual(first.events.map((e) => e.ok), [true, false, false, false]);
  assert.equal(first.events[0].summary, 'npm test');
});

test('secrets are redacted and long input truncated; nothing but a summary is stored', () => {
  const dir = project();
  const key = `sk-ant-${'a'.repeat(30)}`;
  trace.logToolEvent(dir, { session_id: 's', tool_name: 'Bash', tool_input: { command: `curl -H "x: ${key}" host` } });
  trace.logToolEvent(dir, { session_id: 's', tool_name: 'Bash', tool_input: { command: 'echo '.concat('y'.repeat(500)) } });
  const raw = fs.readFileSync(path.join(dir, '.harness', 'traces', 's.jsonl'), 'utf8');
  assert.ok(!raw.includes(key));
  assert.match(raw, /redacted/);
  assert.ok(trace.readSessions(dir)[0].events[1].summary.length <= 201);
});

test('session ids cannot escape the traces directory', () => {
  const dir = project();
  trace.logStop(dir, { session_id: '../../evil' });
  assert.deepEqual(fs.readdirSync(path.join(dir, '.harness', 'traces')), ['.._.._evil.jsonl']);
});

test('logging never throws when the project directory is unwritable', () => {
  const blocker = path.join(project(), 'file');
  fs.writeFileSync(blocker, 'x');
  const unwritable = path.join(blocker, 'sub');
  assert.doesNotThrow(() => trace.logToolEvent(unwritable, { session_id: 's', tool_name: 'Bash' }));
  assert.doesNotThrow(() => trace.recordHookError('h', new Error('boom'), unwritable));
});

test('the post-tool hook records and always exits 0, even on garbage input', () => {
  const dir = project();
  const run = (input) => spawnSync('node', [HOOK], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(run(JSON.stringify({ session_id: 'h', tool_name: 'Bash', tool_input: { command: 'ls' } })).status, 0);
  assert.equal(run('{garbage').status, 0);
  assert.equal(trace.readSessions(dir)[0].events.length, 1);
});

test('efficiency fails on repeated identical failures and on a high failure ratio', () => {
  const repeated = efficiency([sh('npm run dev 3000', false), sh('npm run dev 3001', false), sh('npm run dev 3002', false)]);
  assert.equal(repeated.pass, false);
  assert.match(repeated.reasons[0], /failed 3x/);
  const noisy = efficiency([sh('a', false), sh('b', false), sh('c'), sh('d'), sh('e')]);
  assert.equal(noisy.pass, false);
  assert.match(noisy.reasons[0], /2 of 5/);
  assert.equal(efficiency([sh('a'), sh('b', false), sh('c')]).pass, true);
  assert.equal(efficiency([]).pass, true);
});

test('verified-before-done needs a passing check after the last code edit; docs do not count as code', () => {
  assert.equal(verifiedBeforeDone([edit('src/a.js')]).pass, false);
  assert.equal(verifiedBeforeDone([edit('src/a.js'), sh('npm test', false)]).pass, false);
  assert.equal(verifiedBeforeDone([sh('npm test'), edit('src/a.js')]).pass, false);
  assert.equal(verifiedBeforeDone([edit('src/a.js'), sh('node --test test/')]).pass, true);
  assert.equal(verifiedBeforeDone([edit('README.md'), edit('docs/x.txt')]).pass, true);
  assert.equal(verifiedBeforeDone([]).pass, true);
});

test('guardrail-attempts lists each blocked action', () => {
  const r = guardrailAttempts([{ type: 'blocked', tool: 'Bash', summary: 'git push -f', reason: 'force push' }]);
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /git push -f/);
  assert.equal(guardrailAttempts([]).pass, true);
  assert.equal(scoreSession([]).length, 3);
});

function seed(dir, id, ts, events) {
  for (const e of events) trace.logToolEvent(dir, { session_id: id, tool_name: e.tool, tool_input: { command: e.summary, file_path: e.summary }, hook_event_name: e.ok ? 'PostToolUse' : 'PostToolUseFailure' }, ts);
}

test('report aggregates pass rates, top failures and before/after a marker', () => {
  const dir = project();
  seed(dir, 'old1', 100, [edit('src/a.js')]);
  seed(dir, 'old2', 200, [edit('src/b.js')]);
  addMarker(dir, 'merged verify-skill', 300);
  seed(dir, 'new1', 400, [edit('src/c.js'), sh('npm test')]);
  seed(dir, 'new2', 500, [edit('src/d.js'), sh('npm test')]);
  const report = buildReport(dir);
  assert.equal(report.sessionCount, 4);
  const verified = report.scorers.find((s) => s.name === 'verified-before-done');
  assert.equal(verified.passRate, 0.5);
  assert.equal(report.topFailures[0].count, 2);
  const marker = report.markers[0];
  assert.equal(marker.beforeSessions, 2);
  assert.deepEqual(marker.rates.find((r) => r.name === 'verified-before-done'), { name: 'verified-before-done', before: 0, after: 1 });
  const md = renderMarkdown(report);
  assert.match(md, /merged verify-skill/);
  assert.match(md, /verified-before-done 0% -> 100%/);
});

test('report with no sessions says so, and hook errors are surfaced', () => {
  const dir = project();
  assert.match(renderMarkdown(buildReport(dir)), /No sessions recorded/);
  trace.recordHookError('pre-bash', new Error('boom'), dir);
  seed(dir, 's', 1, [sh('ls')]);
  assert.match(renderMarkdown(buildReport(dir)), /pre-bash: boom/);
  assert.throws(() => addMarker(dir, '  '), /label/);
});

test('report CLI prints markdown, json, writes scores.jsonl, records markers and rejects bad flags', () => {
  const dir = project();
  seed(dir, 's', 1, [edit('src/a.js')]);
  const cli = (...args) => spawnSync('node', [REPORT, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const md = cli();
  assert.equal(md.status, 0);
  assert.match(md.stdout, /verified-before-done/);
  assert.equal(JSON.parse(cli('--json').stdout).sessionCount, 1);
  assert.equal(fs.readFileSync(path.join(dir, '.harness', 'scores.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(cli('--mark', 'shipped x').status, 0);
  assert.match(cli().stdout, /shipped x/);
  assert.equal(cli('--last', '0').status, 2);
  assert.equal(cli('--mark').status, 2);
  assert.equal(cli('--help').status, 0);
});
