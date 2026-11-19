'use strict';
const REPORT_FILE = 'HARNESS-DIAGNOSIS.md';
const MAX_CLUSTERS = 8;
const MAX_TESTS_SHOWN = 6;
const NO_MESSAGE = '(no error message captured)';

// Paths, ids and numbers (timings, counts, pids) change between identical failures; strip them.
function normaliseFailure(text) {
  return text
    .replace(/(?:\/[\w.@+-]+){2,}/g, '<path>')
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\b/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '#');
}

const FAIL_LINE = /^\s*(?:✖|not ok \d+\s*-?)\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/;
const ERROR_LINE = /^\s*(?:error:\s*(.+)|((?:\w+)?Error(?: \[[\w_]+\])?:.*))\s*$/;
const NOT_A_TEST = /^failing tests:?$/i;

// Understands the node:test spec and TAP reporters. Anything else yields no clusters (callers fall back to the raw tail).
function clusterFailures(output) {
  const messages = new Map();
  let current = null;
  for (const line of output.split('\n')) {
    const fail = FAIL_LINE.exec(line);
    if (fail && !NOT_A_TEST.test(fail[1])) {
      current = fail[1];
      if (!messages.has(current)) messages.set(current, null);
      continue;
    }
    if (/^\s*(?:ℹ|test at )/.test(line)) { current = null; continue; }
    const err = ERROR_LINE.exec(line);
    if (err && current && messages.get(current) === null) {
      messages.set(current, (err[1] ?? err[2]).replace(/^['"]|['"]$/g, '').trim());
      current = null;
    }
  }
  const groups = new Map();
  for (const [name, message] of messages) {
    const key = normaliseFailure(message ?? NO_MESSAGE);
    const group = groups.get(key) ?? { message: message ?? NO_MESSAGE, count: 0, tests: [] };
    group.count += 1;
    group.tests.push(name);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function describeClusters(clusters) {
  return clusters.slice(0, MAX_CLUSTERS).map((c, i) => {
    const shown = c.tests.slice(0, MAX_TESTS_SHOWN).map((t) => `"${t}"`).join(', ');
    const more = c.tests.length > MAX_TESTS_SHOWN ? `, +${c.tests.length - MAX_TESTS_SHOWN} more` : '';
    return `${i + 1}. [${c.count}x] ${c.message}\n   tests: ${shown}${more}`;
  }).join('\n');
}

// One bounded turn at the end of a stuck run. A stuck loop is usually a broken eval, not a model that cannot do better.
function diagnosisPrompt({ haltStatus, clusters, outputTail, reportFile = REPORT_FILE }) {
  const evidence = clusters.length > 0
    ? `Remaining failures, grouped by error:\n${describeClusters(clusters)}`
    : `Could not group the failures; raw verify output (tail):\n${outputTail}`;
  return [
    `The run is stuck (${haltStatus}). Do not fix anything now: do not edit code, tests, the spec or the harness. This is one diagnosis turn.`,
    evidence,
    `Write ${reportFile} in the project root. For each failure group give a verdict, the evidence and the next step for a human:`,
    '- IMPL_BUG: the implementation is wrong and a fix is within reach.',
    '- TEST_AMBIGUOUS: the spec does not determine the expected behaviour, so two reasonable implementations disagree.',
    '- TEST_WRONG: the test contradicts the spec, or can never pass as written.',
    '- ENV: tooling, network, ports, timing or flakiness rather than logic.',
    'Be honest about TEST_* verdicts: they mean the eval needs fixing, not more attempts. Then stop.',
  ].join('\n\n');
}

module.exports = { clusterFailures, diagnosisPrompt, normaliseFailure, REPORT_FILE };
