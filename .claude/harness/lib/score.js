'use strict';
// Deterministic scorers over one session trace. Each returns { name, pass, score (0..1), reasons[] }.
// They are the cheap, objective half of the loop; an LLM judge can add subjective rubrics on top
// (verbosity, test redundancy) using the same trace as evidence.
const { EDIT_TOOLS } = require('./trace');

const MIN_CALLS_FOR_RATIO = 5;
const MAX_FAIL_RATIO = 0.25;
const REPEAT_FAILURES = 3;
const DOC_FILE = /\.(md|mdx|txt|rst)$|(^|\/)docs\//i;
const TEST_COMMAND = /\b(npm (run )?(test|verify|lint|build)|node (--test|\S*verify\.js|\S*harness\.js verify)|pytest|jest|vitest|go test|cargo test)\b/;

const tools = (events) => events.filter((e) => e.type === 'tool');
const pct = (n) => `${Math.round(n * 100)}%`;

// Did the agent waste calls: many failed tool calls, or the same failing call over and over?
function efficiency(events) {
  const calls = tools(events);
  const failed = calls.filter((e) => !e.ok);
  const reasons = [];
  const ratio = calls.length === 0 ? 0 : failed.length / calls.length;
  const bySig = new Map();
  for (const e of failed) bySig.set(e.sig, [...(bySig.get(e.sig) ?? []), e]);
  for (const group of bySig.values()) {
    if (group.length >= REPEAT_FAILURES) reasons.push(`${group[0].tool} failed ${group.length}x with the same signature: ${group[0].summary}`);
  }
  if (calls.length >= MIN_CALLS_FOR_RATIO && ratio > MAX_FAIL_RATIO) reasons.push(`${failed.length} of ${calls.length} tool calls failed (${pct(ratio)})`);
  return { name: 'efficiency', pass: reasons.length === 0, score: Number((1 - ratio).toFixed(2)), reasons };
}

const isCodeEdit = (e) => e.type === 'tool' && EDIT_TOOLS.has(e.tool) && !DOC_FILE.test(e.summary);
const isPassingCheck = (e) => e.type === 'tool' && e.tool === 'Bash' && e.ok && TEST_COMMAND.test(e.summary);

// "Done" must be backed by evidence: after the last code edit, a test/verify/build command succeeded.
function verifiedBeforeDone(events) {
  const lastEdit = events.map((e, i) => (isCodeEdit(e) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  if (lastEdit === -1) return { name: 'verified-before-done', pass: true, score: 1, reasons: [] };
  const verified = events.slice(lastEdit + 1).some(isPassingCheck);
  return {
    name: 'verified-before-done',
    pass: verified,
    score: verified ? 1 : 0,
    // No file name in the reason: identical failures must collapse into one cluster in the report.
    reasons: verified ? [] : ['code was edited and no test, verify or build command succeeded afterwards'],
  };
}

// The agent ran into a guardrail. Not always bad, but each one is a signal that instructions are unclear.
function guardrailAttempts(events) {
  const blocked = events.filter((e) => e.type === 'blocked');
  return {
    name: 'guardrail-attempts',
    pass: blocked.length === 0,
    score: Number((1 / (1 + blocked.length)).toFixed(2)),
    reasons: blocked.map((e) => `${e.tool} blocked (${e.reason}): ${e.summary}`),
  };
}

const SCORERS = [efficiency, verifiedBeforeDone, guardrailAttempts];
const scoreSession = (events) => SCORERS.map((scorer) => scorer(events));

module.exports = { scoreSession, efficiency, verifiedBeforeDone, guardrailAttempts, SCORERS };
