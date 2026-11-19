'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clusterFailures, diagnosisPrompt } = require('../lib/failure-cluster');

const SPEC_OUTPUT = `✔ passes (1ms)
✖ creates todo (3.1ms)
✖ lists todos (2.2ms)
✖ rejects empty title (1.0ms)
ℹ tests 4

failing tests:

test at tests/a.test.js:3:1
✖ creates todo (3.1ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 200 !== 201
test at tests/a.test.js:9:1
✖ lists todos (2.2ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 200 !== 201
test at tests/a.test.js:15:1
✖ rejects empty title (1.0ms)
  Error: connect ECONNREFUSED 127.0.0.1:3000
`;

test('groups failing tests by their normalised error line', () => {
  const clusters = clusterFailures(SPEC_OUTPUT);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].count, 2);
  assert.deepEqual(clusters[0].tests.sort(), ['creates todo', 'lists todos']);
  assert.match(clusters[1].message, /ECONNREFUSED/);
});

test('parses TAP output too', () => {
  const tap = 'ok 1 - fine\nnot ok 2 - broken thing\n  ---\n  error: \'boom happened\'\n  ...\n';
  const clusters = clusterFailures(tap);
  assert.equal(clusters[0].tests[0], 'broken thing');
});

test('returns no clusters for output it cannot parse', () => {
  assert.deepEqual(clusterFailures('some random build failure'), []);
});

test('the diagnosis prompt asks for a classification, forbids fixing, and names the report file', () => {
  const p = diagnosisPrompt({ haltStatus: 'halted-stalled', clusters: clusterFailures(SPEC_OUTPUT), outputTail: 'tail', reportFile: 'HARNESS-DIAGNOSIS.md' });
  for (const word of ['IMPL_BUG', 'TEST_AMBIGUOUS', 'TEST_WRONG', 'ENV']) assert.match(p, new RegExp(word));
  assert.match(p, /HARNESS-DIAGNOSIS\.md/);
  assert.match(p, /do not (fix|edit|change)/i);
  assert.match(p, /creates todo/);
});

test('the prompt falls back to the raw tail when nothing could be clustered', () => {
  const p = diagnosisPrompt({ haltStatus: 'halted-max-iterations', clusters: [], outputTail: 'RAW TAIL TEXT', reportFile: 'R.md' });
  assert.match(p, /RAW TAIL TEXT/);
});
