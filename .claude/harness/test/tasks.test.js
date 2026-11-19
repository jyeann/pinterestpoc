'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseTasks, validateTasks, readyTasks, summarise } = require('../lib/tasks');

const NEXT_TASK = path.join(__dirname, '..', 'bin', 'next-task.js');

const SAMPLE = `# Tasks

## T1: Schema and dashboard points
- type: AFK
- blocked-by: none
- status: todo

Free text under a task is ignored.

## T2: Streaks
- type: AFK
- blocked-by: T1
- status: todo

## T3: Pick level thresholds
- type: HITL
- blocked-by: none
- status: todo

## T4: Backfill
- type: AFK
- blocked-by: T1, T3
- status: todo
`;

test('parseTasks reads id, title, type, dependencies and status', () => {
  const tasks = parseTasks(SAMPLE);
  assert.equal(tasks.length, 4);
  assert.deepEqual(tasks[0], { id: 'T1', title: 'Schema and dashboard points', type: 'AFK', blockedBy: [], status: 'todo' });
  assert.deepEqual(tasks[3].blockedBy, ['T1', 'T3']);
});

test('parseTasks defaults a missing status to todo and normalises case', () => {
  const [t] = parseTasks('## A1: x\n- type: afk\n- blocked-by: None\n');
  assert.equal(t.status, 'todo');
  assert.equal(t.type, 'AFK');
  assert.deepEqual(t.blockedBy, []);
});

test('validateTasks accepts a well-formed graph', () => {
  assert.deepEqual(validateTasks(parseTasks(SAMPLE)), []);
});

test('validateTasks reports duplicate ids, unknown deps, bad type and bad status', () => {
  const tasks = parseTasks('## A: one\n- type: AFK\n## A: two\n- type: ROBOT\n- blocked-by: Z\n- status: wip\n');
  const errors = validateTasks(tasks).join('\n');
  assert.match(errors, /duplicate id A/);
  assert.match(errors, /A: unknown type "ROBOT"/);
  assert.match(errors, /A: blocked by unknown task Z/);
  assert.match(errors, /A: unknown status "wip"/);
});

test('validateTasks reports a task with no type and a dependency cycle', () => {
  const tasks = parseTasks('## A: a\n- blocked-by: B\n## B: b\n- type: AFK\n- blocked-by: A\n');
  const errors = validateTasks(tasks).join('\n');
  assert.match(errors, /A: missing type/);
  assert.match(errors, /dependency cycle/);
});

test('validateTasks reports a task blocked by itself', () => {
  const errors = validateTasks(parseTasks('## A: a\n- type: AFK\n- blocked-by: A\n')).join('\n');
  assert.match(errors, /dependency cycle/);
});

test('validateTasks flags an empty task file', () => {
  assert.deepEqual(validateTasks([]), ['no tasks found (expected "## <id>: <title>" headings)']);
});

test('readyTasks returns only unblocked todo AFK tasks', () => {
  assert.deepEqual(readyTasks(parseTasks(SAMPLE)).map((t) => t.id), ['T1']);
});

test('readyTasks unlocks dependents once their blockers are done', () => {
  const done = SAMPLE.replace(/(## T1[\s\S]*?status: )todo/, '$1done').replace(/(## T3[\s\S]*?status: )todo/, '$1done');
  assert.deepEqual(readyTasks(parseTasks(done)).map((t) => t.id), ['T2', 'T4']);
});

test('readyTasks can include human-in-the-loop tasks', () => {
  assert.deepEqual(readyTasks(parseTasks(SAMPLE), { includeHitl: true }).map((t) => t.id), ['T1', 'T3']);
});

test('summarise distinguishes done, needs-human, blocked and ready', () => {
  assert.equal(summarise(parseTasks(SAMPLE)).state, 'ready');
  const allDone = parseTasks('## A: a\n- type: AFK\n- status: done\n');
  assert.equal(summarise(allDone).state, 'all-done');
  const onlyHitl = parseTasks('## A: a\n- type: HITL\n');
  assert.equal(summarise(onlyHitl).state, 'needs-human');
  const stuck = parseTasks('## A: a\n- type: AFK\n- status: blocked\n## B: b\n- type: AFK\n- blocked-by: A\n');
  assert.equal(summarise(stuck).state, 'stuck');
});

function runCli(content, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-'));
  const file = path.join(dir, 'TASKS.md');
  if (content !== null) fs.writeFileSync(file, content);
  try {
    return spawnSync(process.execPath, [NEXT_TASK, file, ...args], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('next-task CLI prints ready tasks and exits 0', () => {
  const r = runCli(SAMPLE);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /T1\tSchema and dashboard points/);
});

test('next-task CLI --json prints machine-readable output', () => {
  const r = runCli(SAMPLE, ['--json']);
  const out = JSON.parse(r.stdout);
  assert.equal(out.state, 'ready');
  assert.deepEqual(out.ready.map((t) => t.id), ['T1']);
});

test('next-task CLI exits 3 with ALL_DONE when every task is done', () => {
  const r = runCli('## A: a\n- type: AFK\n- status: done\n');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /ALL_DONE/);
});

test('next-task CLI exits 3 with NEEDS_HUMAN when only human tasks remain', () => {
  const r = runCli('## A: a\n- type: HITL\n');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NEEDS_HUMAN/);
});

test('next-task CLI exits 3 with STUCK when nothing can proceed', () => {
  const r = runCli('## A: a\n- type: AFK\n- status: blocked\n');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /STUCK/);
});

test('next-task CLI exits 2 on an invalid file and lists the problems', () => {
  const r = runCli('## A: a\n- type: AFK\n- blocked-by: Z\n');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown task Z/);
});

test('next-task CLI exits 2 when the file is missing', () => {
  const r = runCli(null);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
});

test('parseTasks handles CRLF line endings', () => {
  const tasks = parseTasks('## A: one\r\n- type: AFK\r\n- blocked-by: none\r\n- status: done\r\n');
  assert.deepEqual(tasks, [{ id: 'A', title: 'one', type: 'AFK', blockedBy: [], status: 'done' }]);
});

test('a malformed heading does not leak its fields into the previous task', () => {
  const tasks = parseTasks('## T1: one\n- type: AFK\n- status: done\n\n## T2 no colon\n- status: todo\n\n## Notes\n- type: HITL\n');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, 'done');
  assert.equal(tasks[0].type, 'AFK');
});

test('summarise reports in-progress when a task is doing and the rest wait on it', () => {
  const tasks = parseTasks('## A: a\n- type: AFK\n- status: doing\n## B: b\n- type: AFK\n- blocked-by: A\n');
  assert.equal(summarise(tasks).state, 'in-progress');
});

test('next-task CLI exits 3 with IN_PROGRESS while a task is doing', () => {
  const r = runCli('## A: a\n- type: AFK\n- status: doing\n');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /IN_PROGRESS/);
});
