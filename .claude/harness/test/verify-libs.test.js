'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { lineCoverage, collectCoverage } = require('../lib/v8-coverage');
const { listMutations, applyMutation, selectMutations, maskNonCode } = require('../lib/mutate');
const { analyzeTestFile } = require('../lib/test-quality');
const { parseTestSummary, extractFailures } = require('../lib/summary');
const { mutationTimeoutMs } = require('../lib/strong-verify');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verify-libs-'));

// ---------- v8 coverage ----------
const SRC = ['// header comment', 'function a() {', '  return 1;', '}', '', 'function b() {', '  return 2;', '}'].join('\n');
const offsetOf = (needle) => SRC.indexOf(needle);
const bBody = { startOffset: offsetOf('function b'), endOffset: SRC.length, count: 0 };
const wholeFile = { startOffset: 0, endOffset: SRC.length, count: 1 };

test('lineCoverage ignores blank and comment lines and marks uncovered blocks', () => {
  const r = lineCoverage(SRC, [[{ ranges: [wholeFile, bBody] }]]);
  assert.equal(r.executable, 6);
  assert.equal(r.covered, 3);
  assert.deepEqual(r.uncoveredLines, [6, 7, 8]);
  assert.equal(r.pct, 50);
});

test('lineCoverage unions coverage across processes', () => {
  const procA = [{ ranges: [wholeFile, bBody] }];
  const procB = [{ ranges: [{ ...wholeFile }] }];
  assert.equal(lineCoverage(SRC, [procA, procB]).pct, 100);
});

test('lineCoverage reports 0% for a file no process loaded', () => {
  const r = lineCoverage(SRC, []);
  assert.equal(r.pct, 0);
  assert.equal(r.executable, 6);
});

test('collectCoverage groups function ranges by project-relative path and ignores node_modules and outside files', () => {
  const root = tmp();
  const cov = tmp();
  const url = (p) => pathToFileURL(path.join(root, p)).href;
  const payload = {
    result: [
      { url: url('src/a.js'), functions: [{ ranges: [wholeFile] }] },
      { url: url('node_modules/x/i.js'), functions: [] },
      { url: 'file:///elsewhere/src/z.js', functions: [] },
      { url: 'node:internal/foo', functions: [] },
    ],
  };
  fs.writeFileSync(path.join(cov, 'coverage-1.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(cov, 'coverage-2.json'), JSON.stringify(payload));
  fs.writeFileSync(path.join(cov, 'not-json.txt'), 'ignored');
  const map = collectCoverage(cov, root);
  assert.deepEqual([...map.keys()], ['src/a.js']);
  assert.equal(map.get('src/a.js').length, 2);
});

// ---------- mutation ----------
test('listMutations finds operators in code but not in strings or comments', () => {
  const src = [
    "const msg = 'a === b && true';",
    '// x === y || false',
    '/* a !== b */',
    'if (a === b && c) return true;',
  ].join('\n');
  const kinds = listMutations(src).map((m) => `${m.from}->${m.to}`);
  assert.deepEqual(kinds.sort(), ['&&->||', '===->!==', 'true->false'].sort());
});

test('applyMutation changes exactly one occurrence and keeps the rest', () => {
  const src = 'if (a === b) { return a === c; }';
  const muts = listMutations(src);
  assert.equal(muts.length, 2);
  const mutated = applyMutation(src, muts[0]);
  assert.equal(mutated, 'if (a !== b) { return a === c; }');
});

test('mutants that would not compile are dropped', () => {
  const src = 'const x = a >= 1 ? 1 : 2;\nconst fn = (v) => v > 0;\n';
  for (const m of listMutations(src)) assert.doesNotThrow(() => new (require('node:vm').Script)(applyMutation(src, m)));
});

test('selectMutations is deterministic for a seed, bounded, and spreads across files', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => ({ file: 'a.js', index: i })),
    ...Array.from({ length: 10 }, (_, i) => ({ file: 'b.js', index: i })),
  ];
  const one = selectMutations(pool, 6, 'seed');
  assert.deepEqual(selectMutations(pool, 6, 'seed'), one);
  assert.equal(one.length, 6);
  assert.equal(new Set(one.map((m) => m.file)).size, 2);
  assert.equal(selectMutations(pool.slice(0, 3), 6, 's').length, 3);
  assert.notDeepEqual(selectMutations(pool, 6, 'other-seed'), one);
});

// ---------- test quality ----------
const GOOD = "const { add } = require('../src/math');\ntest('a', () => { assert.equal(add(1,2),3); assert.equal(add(0,0),0); assert.throws(() => add()); });";

test('analyzeTestFile accepts a test that exercises src with real assertions', () => {
  assert.deepEqual(analyzeTestFile(GOOD, { srcDirs: ['src'], minAssertions: 3 }).issues, []);
});

test('analyzeTestFile flags tautologies, skips, missing src reference and thin assertions', () => {
  const opts = { srcDirs: ['src'], minAssertions: 3 };
  const placeholder = "const test = require('node:test');\ntest('smoke', () => { assert.ok(true); });";
  const issues = analyzeTestFile(placeholder, opts).issues.join(' | ');
  assert.match(issues, /tautolog/i);
  assert.match(issues, /src/i);
  assert.match(issues, /assertion/i);
  assert.match(analyzeTestFile(`${GOOD}\ntest.skip('x', () => {});`, opts).issues.join(), /skip/i);
  assert.match(analyzeTestFile(`${GOOD}\nexpect(true).toBe(true);`, opts).issues.join(), /tautolog/i);
  assert.match(analyzeTestFile(`${GOOD}\nassert.equal(1, 1);`, opts).issues.join(), /tautolog/i);
});

// ---------- summary ----------
test('parseTestSummary reads tap and spec reporter totals', () => {
  const tap = '# tests 14\n# suites 0\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 1\n';
  assert.deepEqual(parseTestSummary(tap), { tests: 14, pass: 12, fail: 0, skipped: 1, todo: 1 });
  assert.equal(parseTestSummary('ℹ tests 3\nℹ pass 3\nℹ fail 0\nℹ skipped 0\nℹ todo 0').tests, 3);
  assert.deepEqual(parseTestSummary('no summary here'), { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 });
});

// ---------- mutation timeout ----------
test('mutationTimeoutMs scales with the baseline, with a floor and a cap', () => {
  const cfg = { timeoutMs: 120000, timeoutFactor: 3, minTimeoutMs: 10000 };
  assert.equal(mutationTimeoutMs(1000, cfg), 10000);
  assert.equal(mutationTimeoutMs(20000, cfg), 60000);
  assert.equal(mutationTimeoutMs(90000, cfg), 120000);
});

// ---------- review round: masking, shebang, summary, BOM, comments ----------
test('a regex literal containing a quote does not invert string/code masking', () => {
  const src = 'const r = /["\']/;\nconst s = a === b ? "x" : "y";\nconst t = "p === q";';
  const lines = listMutations(src).filter((m) => m.from === '===').map((m) => m.line);
  assert.deepEqual(lines, [2]);
});

test('division is not mistaken for a regex, and template text is masked while ${} code is not', () => {
  assert.equal(listMutations('const h = a / 2 === b / 2;').length, 1);
  const src = 'const m = `a === b ${x === y ? "p" : "q"} c === d`;';
  const muts = listMutations(src).filter((m) => m.from === '===');
  assert.equal(muts.length, 1);
  assert.equal(src.slice(muts[0].index - 2, muts[0].index), 'x ');
  assert.equal(maskNonCode(src).length, src.length);
});

test('a shebang does not hide every mutant of a CommonJS file', () => {
  assert.equal(listMutations('#!/usr/bin/env node\nif (a === b) x();').length, 1);
});

test('parseTestSummary adds up several summaries (npm test && node --test acceptance)', () => {
  const two = '# tests 3\n# pass 3\n# fail 0\n# skipped 1\n# todo 0\n# tests 4\n# pass 4\n# fail 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(parseTestSummary(two), { tests: 7, pass: 7, fail: 0, skipped: 1, todo: 0 });
});

test('lineCoverage ignores a leading BOM and tolerates unsorted ranges', () => {
  const r = lineCoverage(`\uFEFF${SRC}`, [[{ ranges: [bBody, wholeFile] }]]);
  assert.equal(r.pct, 50);
});

test('analyzeTestFile does not count comments as src references or assertions', () => {
  const faked = "// uses src/foo\n/* assert.equal(a, b); assert.equal(c, d); assert.equal(e, f); */\ntest('x', () => { assert.ok(1 + 1 === 2); });";
  const issues = analyzeTestFile(faked, { srcDirs: ['src'], minAssertions: 3 }).issues.join(' | ');
  assert.match(issues, /never references the source/);
  assert.match(issues, /1 assertion/);
});

// ---------- failing-test extraction ----------
const TAP = [
  'TAP version 13', '# Subtest: adds', 'ok 1 - adds', '  ---', '  duration_ms: 0.4', "  type: 'test'", '  ...',
  '# Subtest: held-out: negative zero never escapes', 'not ok 2 - held-out: negative zero never escapes', '  ---', '  duration_ms: 1.2', "  type: 'test'",
  "  location: '/tmp/x.test.js:9:1'", "  failureType: 'testCodeFailure'", '  error: |-', '    Expected values to be strictly deep-equal:', '    -0 !== 0',
  "  code: 'ERR_ASSERTION'", "  name: 'AssertionError'", '  expected: 0', '  actual: -0', '  stack: |-', '    at TestContext.<anonymous> (/tmp/x.test.js:10:3)', '    at node:internal/foo', '  ...',
  'not ok 3 - parser survives nesting', '  ---', '  duration_ms: 9', '  error: RangeError', "  error: 'Maximum call stack size exceeded'", '  stack: |-', '    at deep', '  ...',
  '1..3', '# tests 3', '# pass 1', '# fail 2',
].join('\n');

test('extractFailures keeps each failing test name with its assertion details and drops noise and stacks', () => {
  const out = extractFailures(TAP);
  assert.match(out, /held-out: negative zero never escapes/);
  assert.match(out, /-0 !== 0/);
  assert.match(out, /expected: 0/);
  assert.match(out, /actual: -0/);
  assert.match(out, /parser survives nesting/);
  assert.match(out, /Maximum call stack size exceeded/);
  assert.doesNotMatch(out, /duration_ms|location:|at TestContext|node:internal|# Subtest|adds/);
});

test('extractFailures is bounded, reports how many were omitted, and returns empty when nothing failed', () => {
  assert.equal(extractFailures('ok 1 - fine\n# tests 1\n# pass 1\n'), '');
  const many = Array.from({ length: 30 }, (_, i) => `not ok ${i + 1} - t${i}\n  ---\n  error: 'boom ${i}'\n  ...`).join('\n');
  const out = extractFailures(many, { maxFailures: 5, maxChars: 4000 });
  assert.match(out, /t0/);
  assert.doesNotMatch(out, /t6/);
  assert.match(out, /25 more failing test/);
  assert.ok(extractFailures(many, { maxFailures: 30, maxChars: 300 }).length <= 400);
});
