'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideStop, failureSignature, tailOutput } = require('../lib/stop-loop');

const base = {
  active: true, iteration: 0, maxIterations: 5, stallLimit: 3,
  lastSignature: null, stallCount: 0, status: 'running', history: [],
};
const fail = (output = 'FAIL: 1 test failed') => ({ pass: false, output, timedOut: false });
const pass = { pass: true, output: 'ok', timedOut: false };

test('allows stopping when no run is active', () => {
  const d = decideStop({ ...base, active: false }, fail());
  assert.equal(d.decision, 'allow');
});

test('allows stopping and deactivates when verification passes', () => {
  const d = decideStop(base, pass);
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.active, false);
  assert.equal(d.nextState.status, 'passed');
});

test('blocks with the failure tail and advances the iteration', () => {
  const d = decideStop(base, fail('line1\nAssertionError: expected 201'));
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /AssertionError: expected 201/);
  assert.match(d.reason, /iteration 1 of 5/i);
  assert.equal(d.nextState.iteration, 1);
  assert.equal(d.nextState.active, true);
});

test('does not mutate the input state', () => {
  const frozen = Object.freeze({ ...base, history: Object.freeze([]) });
  assert.doesNotThrow(() => decideStop(frozen, fail()));
});

test('halts when the iteration cap is reached (diagnosis off)', () => {
  const d = decideStop({ ...base, iteration: 5, diagnose: false }, fail());
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.status, 'halted-max-iterations');
  assert.equal(d.nextState.active, false);
});

test('circuit breaker halts after stallLimit identical failures in a row', () => {
  let state = base;
  const outcomes = [];
  for (let i = 0; i < 3; i += 1) {
    const d = decideStop({ ...state, diagnose: false }, fail('same failure took 12ms'));
    outcomes.push(d.decision);
    state = d.nextState;
  }
  assert.deepEqual(outcomes, ['block', 'block', 'allow']);
  assert.equal(state.status, 'halted-stalled');
});

test('progress resets the stall counter', () => {
  let state = decideStop(base, fail('error A')).nextState;
  state = decideStop(state, fail('error A')).nextState;
  assert.equal(state.stallCount, 1);
  state = decideStop(state, fail('error B')).nextState;
  assert.equal(state.stallCount, 0);
});

test('failureSignature ignores timings and counts', () => {
  assert.equal(failureSignature('failed in 12.5ms, 3 tests'), failureSignature('failed in 99ms, 7 tests'));
  assert.notEqual(failureSignature('error A'), failureSignature('error B'));
});

test('a timeout is reported to the agent and counts as a failure', () => {
  const d = decideStop(base, { pass: false, output: '', timedOut: true });
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /timed out/i);
});

test('tailOutput keeps the end and caps the size', () => {
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const tail = tailOutput(long, 20, 500);
  assert.ok(tail.length <= 500);
  assert.match(tail, /line 499/);
  assert.doesNotMatch(tail, /line 0\b/);
});

test('failureSignature ignores temp paths, uuids and hex ids', () => {
  const a = 'ENOENT /tmp/todo-AbC123/nested/todos.json id 3f2a9c1e-77b4-4d1e-9a10-0123456789ab';
  const b = 'ENOENT /tmp/todo-ZyX987/nested/todos.json id 9d8c7b6a-1111-2222-3333-ba9876543210';
  assert.equal(failureSignature(a), failureSignature(b));
});

test('sends the full task only on the first block, then a short pointer', () => {
  const withTask = { ...base, task: 'BUILD THE WHOLE TODO API SPEC', taskFile: 'spec.md' };
  const first = decideStop(withTask, fail('error A'));
  assert.match(first.reason, /BUILD THE WHOLE TODO API SPEC/);
  const second = decideStop(first.nextState, fail('error B'));
  assert.doesNotMatch(second.reason, /BUILD THE WHOLE TODO API SPEC/);
  assert.match(second.reason, /spec\.md/);
  assert.match(second.reason, /error B/);
});

test('later blocks still point at the task when it was given inline (no file)', () => {
  const first = decideStop({ ...base, task: 'inline task text' }, fail('error A'));
  const second = decideStop(first.nextState, fail('error B'));
  assert.doesNotMatch(second.reason, /inline task text/);
  assert.match(second.reason, /first message of this run/i);
});

const failing = 'FAIL: x\n✖ creates todo (3ms)\n  AssertionError: Expected 200 !== 201\n';

test('at the cap the agent gets one diagnosis turn (no fixing) before the run is halted', () => {
  const d = decideStop({ ...base, iteration: 5 }, fail(failing));
  assert.equal(d.decision, 'block');
  assert.equal(d.nextState.active, true);
  assert.equal(d.nextState.diagnosing, 'halted-max-iterations');
  assert.match(d.reason, /IMPL_BUG/);
  assert.match(d.reason, /creates todo/);
  assert.match(d.reason, /HARNESS-DIAGNOSIS\.md/);
});

test('a stall also triggers diagnosis, then the next stop ends the run with the original status', () => {
  let state = { ...base };
  let d;
  for (let i = 0; i < 3; i += 1) { d = decideStop(state, fail(failing)); state = d.nextState; }
  assert.equal(d.decision, 'block');
  assert.equal(state.diagnosing, 'halted-stalled');
  const end = decideStop(state, null, { diagnosisWritten: true });
  assert.equal(end.decision, 'allow');
  assert.equal(end.nextState.status, 'halted-stalled');
  assert.equal(end.nextState.active, false);
  assert.equal(end.nextState.diagnosis, 'written');
  assert.equal(end.nextState.diagnosing, null);
});

test('diagnosis is bounded: a missing report does not trap the agent', () => {
  const end = decideStop({ ...base, diagnosing: 'halted-max-iterations' }, null, { diagnosisWritten: false });
  assert.equal(end.decision, 'allow');
  assert.equal(end.nextState.status, 'halted-max-iterations');
  assert.equal(end.nextState.diagnosis, 'missing');
  assert.match(end.reason, /no diagnosis/i);
});

test('the diagnosis turn does not consume an iteration', () => {
  const d = decideStop({ ...base, iteration: 5 }, fail(failing));
  assert.equal(d.nextState.iteration, 5);
});

const T0 = 1_000_000;
const MIN = 60_000;
const failN = (n) => fail(Array.from({ length: n }, (_, i) => `✖ test ${i} (1ms)\n  AssertionError: boom ${i}-${'x'.repeat(i)}`).join('\n'));

test('halts when the wall-clock budget is spent (diagnosis off)', () => {
  const s = { ...base, diagnose: false, startedAt: T0, maxMinutes: 60 };
  assert.equal(decideStop(s, fail('e'), { now: T0 + 59 * MIN }).decision, 'block');
  const d = decideStop(s, fail('e'), { now: T0 + 61 * MIN });
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.status, 'halted-time');
  assert.match(d.reason, /60 minute/);
});

test('a passing verify wins even after the time budget', () => {
  const s = { ...base, startedAt: T0, maxMinutes: 1 };
  assert.equal(decideStop(s, pass, { now: T0 + 999 * MIN }).nextState.status, 'passed');
});

test('time budget halt also gets the bounded diagnosis turn', () => {
  const d = decideStop({ ...base, startedAt: T0, maxMinutes: 1 }, fail(failing), { now: T0 + 5 * MIN });
  assert.equal(d.decision, 'block');
  assert.equal(d.nextState.diagnosing, 'halted-time');
});

test('no-progress halts after N failing iterations without fewer failing tests, and improvement resets it', () => {
  let state = { ...base, diagnose: false, noProgressLimit: 3, maxIterations: 50, stallLimit: 50 };
  const run = (n) => { const d = decideStop(state, failN(n)); state = d.nextState; return d; };
  run(5);                                   // first observation sets the best
  assert.equal(run(5).decision, 'block');   // 1 without improvement
  assert.equal(run(4).decision, 'block');   // improved: counter resets
  assert.equal(run(4).decision, 'block');   // 1
  assert.equal(run(6).decision, 'block');   // 2
  const d = run(5);                         // 3 -> halt
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.status, 'halted-no-progress');
});

test('no-progress tracking is skipped when failures cannot be counted', () => {
  let state = { ...base, noProgressLimit: 2, maxIterations: 50, stallLimit: 50 };
  for (let i = 0; i < 5; i += 1) {
    const d = decideStop(state, fail(`unparseable ${'z'.repeat(i)} failure`));
    assert.equal(d.decision, 'block');
    state = d.nextState;
  }
});

test('the retry message keeps enough of the verify output for several failing assertions', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
  const d = decideStop(base, fail(lines));
  assert.match(d.reason, /line 59/);
  assert.match(d.reason, /line 10 /);
});
