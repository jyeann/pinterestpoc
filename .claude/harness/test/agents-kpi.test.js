'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const trace = require('../lib/trace');
const { buildKpi, readRoster } = require('../lib/agents-kpi');

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-kpi-'));
const agentCall = (type, extra = {}) => ({ session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: type, description: 'do it', model: 'sonnet', effort: 'high' }, tool_response: { totalTokens: 1200, totalDurationMs: 3000, totalToolUseCount: 4 }, ...extra });

test('an Agent tool call also writes an agent record with model, effort, tokens and duration', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('tdd-guide'), 10);
  const events = trace.readSessions(dir)[0].events;
  const run = events.find((e) => e.type === 'agent');
  assert.deepEqual({ agent: run.agent, model: run.model, effort: run.effort, tokens: run.tokens, durationMs: run.durationMs, toolUses: run.toolUses, ok: run.ok },
    { agent: 'tdd-guide', model: 'sonnet', effort: 'high', tokens: 1200, durationMs: 3000, toolUses: 4, ok: true });
});

test('fields the host does not send stay null instead of being guessed', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Task', tool_input: {}, tool_response: {} }, 10);
  const run = trace.readSessions(dir)[0].events.find((e) => e.type === 'agent');
  assert.equal(run.agent, 'general-purpose');
  assert.equal(run.tokens, null);
  assert.equal(run.durationMs, null);
});

test('non-agent tools write no agent record', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } }, 10);
  assert.equal(trace.readSessions(dir)[0].events.filter((e) => e.type === 'agent').length, 0);
});

test('KPI roll-up counts runs and failures per agent and lists idle roster agents with zero runs', () => {
  const dir = project();
  const agents = path.join(dir, 'agents');
  fs.mkdirSync(agents);
  fs.writeFileSync(path.join(agents, 'tdd-guide.md'), '---\nname: tdd-guide\ndescription: writes tests\nmodel: sonnet\n---\nbody');
  fs.writeFileSync(path.join(agents, 'planner.md'), '---\nname: planner\ndescription: plans\nmodel: opus\neffort: high\n---\nbody');
  trace.logToolEvent(dir, agentCall('tdd-guide'), 10);
  trace.logToolEvent(dir, agentCall('tdd-guide', { hook_event_name: 'PostToolUseFailure' }), 20);
  const kpi = buildKpi(dir, agents);
  const tdd = kpi.rows.find((r) => r.agent === 'tdd-guide');
  const planner = kpi.rows.find((r) => r.agent === 'planner');
  assert.equal(tdd.runs, 2);
  assert.equal(tdd.failed, 1);
  assert.equal(tdd.successRate, 0.5);
  assert.equal(tdd.tokens, 2400);
  assert.equal(planner.runs, 0);
  assert.equal(planner.configuredEffort, 'high');
  assert.equal(kpi.totals.idle, 1);
  assert.equal(kpi.totals.active, 1);
});

test('runs are grouped by model and effort, with unrecorded effort kept as its own group', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('a'), 1);
  trace.logToolEvent(dir, agentCall('b'), 2);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'c', model: 'opus' }, tool_response: { totalTokens: 10 } }, 3);
  const { byEffort } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(byEffort.map((g) => [g.model, g.effort, g.runs, g.tokens]), [['sonnet', 'high', 2, 2400], ['opus', 'not recorded', 1, 10]]);
});

test('a background launch with no tokens or duration counts as unreported, not as a success', () => {
  const dir = project();
  trace.logToolEvent(dir, agentCall('tdd-guide'), 1);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'tdd-guide' }, tool_response: {} }, 2);
  const { rows, totals, recent } = buildKpi(dir, path.join(dir, 'none'));
  const row = rows.find((r) => r.agent === 'tdd-guide');
  assert.equal(row.runs, 2);
  assert.equal(row.unreported, 1);
  assert.equal(row.successRate, 1);
  assert.equal(totals.unreported, 1);
  assert.deepEqual(recent.map((r) => r.outcomeReported), [false, true]);
});

test('an agent whose runs are all unreported has no success rate', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'x' }, tool_response: {} }, 1);
  assert.equal(buildKpi(dir, path.join(dir, 'none')).rows[0].successRate, null);
});

test('roster reader returns an empty list when the agents directory is missing', () => {
  assert.deepEqual(readRoster(path.join(os.tmpdir(), 'no-such-agents-dir-xyz')), []);
});

test('a [phase:x] tag in the agent description attributes the run to that phase', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'planner', description: '[phase:design] draft the system design' }, tool_response: { totalTokens: 100, totalDurationMs: 5 } }, 1);
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'planner', description: 'untagged work' }, tool_response: { totalTokens: 50, totalDurationMs: 5 } }, 2);
  const { byPhase } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(byPhase.map((p) => [p.phase, p.runs, p.tokens]), [['design', 1, 100], ['untagged', 1, 50]]);
});

test('human prompts are counted by length only and every prompt after the first in a session is an intervention', () => {
  const dir = project();
  trace.logHuman(dir, { session_id: 's1', prompt: 'build me a thing' }, 1);
  trace.logHuman(dir, { session_id: 's1', prompt: 'go on' }, 2);
  trace.logHuman(dir, { session_id: 's1', prompt: 'again' }, 3);
  trace.logHuman(dir, { session_id: 's2', prompt: 'other session' }, 4);
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual(human, { sessions: 2, prompts: 4, interventions: 2, recordedPrompts: 4, unclassified: 0 });
  const stored = JSON.stringify(trace.readSessions(dir));
  assert.ok(!stored.includes('build me a thing'));
  assert.ok(stored.includes('"chars":16'));
});

test('the user-prompt hook records a human event from the hook payload', () => {
  const { spawnSync } = require('node:child_process');
  const dir = project();
  const hook = path.join(__dirname, '..', 'hooks', 'user-prompt.js');
  const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: 'h1', hook_event_name: 'UserPromptSubmit', prompt: 'hello there' }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(r.status, 0);
  assert.equal(trace.readSessions(dir)[0].events[0].type, 'human');
});

test('a completion notice fills the matching unreported background run and is flagged as from a notice', () => {
  const dir = project();
  trace.logToolEvent(dir, { session_id: 's1', tool_name: 'Agent', tool_input: { subagent_type: 'architect', description: '[phase:design] design it', effort: 'high' }, tool_response: {} }, 1);
  const finals = [{ agent: 'architect', task: '[phase:design] design it', tokens: 62067, durationMs: 256673, toolUses: 11 }];
  const kpi = buildKpi(dir, path.join(dir, 'none'), { finals });
  const row = kpi.rows.find((r) => r.agent === 'architect');
  assert.equal(row.runs, 1);
  assert.equal(row.tokens, 62067);
  assert.equal(row.unreported, 0);
  assert.equal(kpi.byEffort[0].effort, 'high');
  assert.equal(kpi.byPhase[0].tokens, 62067);
});

test('a completion notice with no matching launch is added as its own run', () => {
  const dir = project();
  const finals = [{ agent: 'planner', task: '[phase:plan] plan it', phase: 'plan', effort: 'medium', model: 'opus', tokens: 40357, durationMs: 53771, toolUses: 5 }];
  const kpi = buildKpi(dir, path.join(dir, 'none'), { finals });
  assert.equal(kpi.totals.runs, 1);
  assert.equal(kpi.byPhase[0].phase, 'plan');
  assert.equal(kpi.byEffort[0].effort, 'medium');
});

test('agent hand-backs, stop-hook feedback and notifications are not counted as human prompts', () => {
  const dir = project();
  trace.logHuman(dir, { session_id: 's1', prompt: 'please build it' }, 1);
  trace.logHuman(dir, { session_id: 's1', prompt: '[Subagent hand-back] The text below is the final report' }, 2);
  trace.logHuman(dir, { session_id: 's1', prompt: 'Stop hook feedback: not done' }, 3);
  trace.logHuman(dir, { session_id: 's1', prompt: '<task-notification><status>completed</status>' }, 4);
  trace.logHuman(dir, { session_id: 's1', prompt: 'Another Claude session sent a message while you were working' }, 5);
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.equal(human.prompts, 1);
  assert.equal(human.interventions, 0);
  assert.equal(human.recordedPrompts, 5);
});

test('events recorded before prompts were classified are reported as unclassified, not as human', () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, '.harness', 'traces'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'traces', 's1.jsonl'), '{"type":"human","ts":1,"chars":162}\n{"type":"human","ts":2,"chars":4000}\n');
  const { human } = buildKpi(dir, path.join(dir, 'none'));
  assert.deepEqual([human.prompts, human.interventions, human.unclassified, human.recordedPrompts], [0, 0, 2, 2]);
});
