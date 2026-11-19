'use strict';

const LINE = /^(?:#|ℹ)\s+(tests|pass|fail|skipped|todo)\s+(\d+)\s*$/gm;

// Sums every summary block, so `npm test && node --test acceptance` counts both. Reads the totals node:test prints, in either the TAP (`# tests 14`) or spec (`ℹ tests 14`) reporter.
function parseTestSummary(output) {
  const totals = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
  for (const [, key, value] of output.matchAll(LINE)) totals[key] += Number(value);
  return totals;
}

const DROP_KEYS = new Set(['duration_ms', 'type', 'location', 'failureType', 'code', 'name', 'stack']);
const MAX_LINES_PER_FAILURE = 8;
const MAX_LINE_CHARS = 200;

// The assertion details of each failing test (names, error text, expected/actual), without the TAP noise of
// passing tests or stack traces. This is what an agent needs to fix a failure, and it must survive a tail cut.
function extractFailures(output, { maxFailures = 6, maxChars = 3000 } = {}) {
  const lines = output.split('\n');
  const failures = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!head) continue;
    const body = [];
    let aggregator = false;
    let keep = true;
    let j = i + 1;
    if (lines[j]?.trim() === '---') {
      for (j += 1; j < lines.length && lines[j].trim() !== '...'; j += 1) {
        const key = lines[j].match(/^\s{2}(\w+):/);
        if (key) {
          keep = !DROP_KEYS.has(key[1]);
          if (key[1] === 'failureType' && /subtestsFailed/.test(lines[j])) aggregator = true;
        }
        if (keep) body.push(lines[j].replace(/^ {2}/, '').slice(0, MAX_LINE_CHARS));
      }
    }
    if (!aggregator) failures.push([`- ${head[1]}`, ...body.slice(0, MAX_LINES_PER_FAILURE).map((l) => `    ${l}`)].join('\n'));
    i = j;
  }
  if (failures.length === 0) return '';
  const shown = failures.slice(0, maxFailures);
  let text = shown.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars)} ...`;
  const omitted = failures.length - shown.length;
  return omitted > 0 ? `${text}\n... and ${omitted} more failing test(s)` : text;
}

module.exports = { parseTestSummary, extractFailures };
