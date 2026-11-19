'use strict';
// A stricter "definition of done" than "tests exit 0":
//   1. tests pass, none skipped/todo, at least minTests ran
//   2. line coverage of the SOURCE files (all processes, V8) meets a total and a per-file floor
//   3. the agent's own tests are not placeholders (reference src, real assertions)
//   4. mutation spot-check: flipping one operator in src must make the suite fail
// Config lives in verify.config.json; protect it (and this file) so the agent cannot weaken the gate.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runVerify } = require('./verify');
const { tailOutput } = require('./stop-loop');
const { parseTestSummary, extractFailures } = require('./summary');
const { lineCoverage, collectCoverage } = require('./v8-coverage');
const { analyzeTestFile } = require('./test-quality');
const { listMutations, applyMutation, selectMutations } = require('./mutate');

const SOURCE_FILE = /\.(?:[cm]?js)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?js$/;

function loadConfig(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`Cannot read config ${file}: ${err.message}`); }
  if (typeof raw.testCommand !== 'string' || !raw.testCommand.trim()) throw new Error('config.testCommand (string) is required');
  const config = {
    testCommand: raw.testCommand,
    timeoutMs: raw.timeoutMs ?? 300_000,
    minTests: raw.minTests ?? 1,
    srcDirs: raw.srcDirs ?? ['src'],
    coverage: { minLines: 80, minFileLines: 50, minSourceFiles: 1, exclude: [], ...raw.coverage },
    testQuality: { dirs: ['tests'], minAssertionsPerFile: 3, ...raw.testQuality },
    replicates: raw.replicates ?? 2,
    holdout: raw.holdout ? { minTests: 1, ...raw.holdout } : null,
    mutation: { samples: 6, minKillRate: 0.6, copy: ['acceptance', 'package.json'], timeoutMs: 120_000, timeoutFactor: 3, minTimeoutMs: 10_000, ...raw.mutation },
  };
  validate(config);
  return config;
}

function validate({ coverage, mutation, replicates, holdout }) {
  const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 5) throw new Error('replicates must be an integer between 1 and 5');
  if (holdout && (typeof holdout.command !== 'string' || !holdout.command.trim())) throw new Error('holdout.command (string) is required when holdout is set');
  if (holdout && (!Number.isInteger(holdout.minTests) || holdout.minTests < 1)) throw new Error('holdout.minTests must be an integer >= 1');
  if (!Number.isInteger(mutation.samples) || mutation.samples < 1) throw new Error('mutation.samples must be an integer >= 1');
  if (!inRange(mutation.minKillRate, 0.01, 1)) throw new Error('mutation.minKillRate must be a number in (0, 1]');
  if (!inRange(coverage.minLines, 0, 100)) throw new Error('coverage.minLines must be between 0 and 100');
  if (!inRange(coverage.minFileLines, 0, 100)) throw new Error('coverage.minFileLines must be between 0 and 100');
  if (!Number.isInteger(coverage.minSourceFiles) || coverage.minSourceFiles < 0) throw new Error('coverage.minSourceFiles must be an integer >= 0');
}

// Temp dirs are removed on normal exit and, via cleanupTempDirs(), when the process is signalled.
const tempDirs = new Set();
function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}
function removeTemp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.delete(dir);
}
function cleanupTempDirs() { for (const dir of [...tempDirs]) removeTemp(dir); }

function walk(root, dir, accept) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(root, rel, accept);
    return accept.test(entry.name) ? [rel] : [];
  });
}

const isExcluded = (rel, exclude) => exclude.some((e) => rel === e || rel.startsWith(e.endsWith('/') ? e : `${e}/`));
const sourceFiles = (root, config) => config.srcDirs
  .flatMap((d) => walk(root, d, SOURCE_FILE))
  .filter((f) => !TEST_FILE.test(f) && !isExcluded(f, config.coverage.exclude));

function ranges(lines) {
  const out = [];
  for (const n of lines) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

function checkTests(result, config) {
  const failures = [];
  const s = parseTestSummary(result.output);
  if (result.timedOut) failures.push(`tests timed out after ${config.timeoutMs} ms`);
  else if (!result.pass || s.fail > 0) failures.push(`tests failed (${s.fail} failing)`);
  if (s.skipped > 0 || s.todo > 0) failures.push(`${s.skipped} skipped and ${s.todo} todo test(s): skipping is not passing`);
  if (s.tests < config.minTests) failures.push(`only ${s.tests} test(s) ran; at least ${config.minTests} expected`);
  return { summary: s, failures };
}

function checkCoverage(root, config, covDir, out) {
  const files = sourceFiles(root, config);
  if (files.length === 0) return [`no source files found under ${config.srcDirs.join(', ')}`];
  const failures = [];
  if (files.length < config.coverage.minSourceFiles) {
    failures.push(`coverage: expected at least ${config.coverage.minSourceFiles} source file(s) under ${config.srcDirs.join(', ')}, found ${files.length}; do not delete source to raise coverage`);
  }
  const byFile = collectCoverage(covDir, root);
  let executable = 0;
  let covered = 0;
  for (const rel of files) {
    const r = lineCoverage(fs.readFileSync(path.join(root, rel), 'utf8'), byFile.get(rel) ?? []);
    executable += r.executable;
    covered += r.covered;
    const detail = r.uncoveredLines.length ? ` uncovered lines: ${ranges(r.uncoveredLines)}` : '';
    out(`  ${rel}  ${r.pct}% (${r.covered}/${r.executable})${detail}`);
    if (r.pct < config.coverage.minFileLines) {
      const hint = r.pct === 0 ? ' (0% usually means the file was never loaded, or a child process running it was killed by a signal before it could write coverage: handle SIGTERM and exit 0)' : '';
      failures.push(`coverage: ${rel} is ${r.pct}%, below the ${config.coverage.minFileLines}% per-file floor${hint}`);
    }
  }
  const total = executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100;
  out(`  total source line coverage: ${total}% (floor ${config.coverage.minLines}%)`);
  if (total < config.coverage.minLines) failures.push(`coverage: total ${total}% is below the ${config.coverage.minLines}% floor`);
  return failures;
}

function checkTestQuality(root, config) {
  const { dirs, minAssertionsPerFile } = config.testQuality;
  const files = dirs.flatMap((d) => walk(root, d, TEST_FILE));
  const hidden = config.srcDirs.flatMap((d) => walk(root, d, TEST_FILE))
    .map((rel) => `test quality: ${rel} is a test file inside the source dir (it is excluded from coverage); keep tests in ${dirs.join(', ')}`);
  if (dirs.length > 0 && files.length === 0) return [`no unit tests found in ${dirs.join(', ')}`, ...hidden];
  return hidden.concat(files.flatMap((rel) => {
    const { issues } = analyzeTestFile(fs.readFileSync(path.join(root, rel), 'utf8'), { srcDirs: config.srcDirs, minAssertions: minAssertionsPerFile });
    return issues.map((issue) => `test quality: ${rel} ${issue}`);
  }));
}

const runSignature = (result) => {
  const s = parseTestSummary(result.output);
  return `${result.pass ? 'pass' : 'fail'}: ${s.pass}/${s.tests} passing, ${s.fail} failing`;
};

// Variance check (the first run's tests passed): the same command must give the same answer again, or the
// gate is noise and the agent would be steered by luck.
async function checkReplicates(root, config, first, out) {
  const failures = [];
  const expected = runSignature(first);
  for (let run = 2; run <= config.replicates; run += 1) {
    const again = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs });
    const got = runSignature(again);
    if (got !== expected) {
      failures.push(`flaky tests: run 1 -> ${expected}; run ${run} -> ${got}. The suite is non-deterministic, so it cannot be a definition of done; make it deterministic`);
      out(tailOutput(again.output, 25, 2500));
      break;
    }
  }
  out(failures.length === 0 ? `  replicates: ${config.replicates} runs agree` : '  replicates: DISAGREE');
  return failures;
}

// Hidden acceptance tests: run only here, and only counts are reported, so the agent cannot code to them.
async function checkHoldout(root, config, out) {
  const { command, minTests } = config.holdout;
  const result = await runVerify(command, { cwd: root, timeoutMs: config.timeoutMs });
  const s = parseTestSummary(result.output);
  out(`  holdout: ${s.pass}/${s.tests} passing`);
  const detail = 'Details are withheld on purpose: re-read the spec\'s acceptance criteria and handle cases beyond the visible tests.';
  if (result.timedOut) return [`holdout: the hidden tests timed out. ${detail}`];
  if (s.tests < minTests) return [`holdout: only ${s.tests} hidden test(s) ran; at least ${minTests} expected (is the holdout set missing?)`];
  if (s.skipped > 0 || s.todo > 0) return ['holdout: skipped or todo hidden tests are not passing'];
  if (!result.pass || s.fail > 0) return [`holdout: ${s.fail || 'some'} of ${s.tests} hidden acceptance test(s) fail. ${detail}`];
  return [];
}

// A mutant that hangs the suite counts as killed, so wait only a few multiples of the healthy run time.
function mutationTimeoutMs(baselineMs, { timeoutMs, timeoutFactor, minTimeoutMs }) {
  return Math.min(timeoutMs, Math.max(minTimeoutMs, Math.round(baselineMs * timeoutFactor)));
}

function copyProject(root, copy) {
  const tmp = makeTemp('verify-mutants-');
  for (const entry of copy) {
    const from = path.join(root, entry);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, entry), { recursive: true });
  }
  const modules = path.join(root, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(tmp, 'node_modules'), 'dir');
  return tmp;
}

async function checkMutation(root, config, baselineMs, out) {
  const files = sourceFiles(root, config);
  const texts = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const pool = files.flatMap((file) => listMutations(texts.get(file)).map((m) => ({ ...m, file })));
  if (pool.length === 0) { out('  mutation: no mutable operators found, skipped'); return []; }

  const seed = crypto.createHash('sha1').update([...texts.values()].join('\0')).digest('hex');
  const picked = selectMutations(pool, config.mutation.samples, seed);
  const tmp = copyProject(root, [...new Set([...config.srcDirs, ...config.testQuality.dirs, ...config.mutation.copy])]);
  const timeoutMs = mutationTimeoutMs(baselineMs, config.mutation);
  const survivors = [];
  const env = { CLAUDE_PROJECT_DIR: tmp };
  try {
    const baseline = await runVerify(config.testCommand, { cwd: tmp, timeoutMs, env });
    if (!baseline.pass) {
      out(tailOutput(baseline.output, 20, 2000));
      return ['mutation: baseline run of the unmutated copy failed, so mutants would all look killed. The copy is missing something the tests need: add it to mutation.copy in verify.config.json'];
    }
    for (const m of picked) {
      const target = path.join(tmp, m.file);
      fs.writeFileSync(target, applyMutation(texts.get(m.file), m));
      const r = await runVerify(config.testCommand, { cwd: tmp, timeoutMs, env });
      fs.writeFileSync(target, texts.get(m.file));
      if (r.pass) survivors.push(m);
    }
  } finally {
    removeTemp(tmp);
  }
  if (picked.length === 0) return ['mutation: no mutants could be sampled'];
  const killRate = (picked.length - survivors.length) / picked.length;
  out(`  mutation: killed ${picked.length - survivors.length}/${picked.length} (${Math.round(killRate * 100)}%, floor ${Math.round(config.mutation.minKillRate * 100)}%)`);
  for (const m of survivors) out(`    survived: ${m.file}:${m.line} \`${m.from}\` -> \`${m.to}\` (no test noticed)`);
  return killRate < config.mutation.minKillRate
    ? [`mutation: ${survivors.length}/${picked.length} mutants survived; the tests run this code but do not pin its behaviour (see survivors above)`]
    : [];
}

async function strongVerify(root, config, { fast = false, out = console.log } = {}) {
  const covDir = makeTemp('verify-cov-');
  const failures = [];
  let failingTests = '';
  try {
    out('[1/5] tests');
    const startedAt = Date.now();
    const result = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs, env: { NODE_V8_COVERAGE: covDir } });
    const baselineMs = Date.now() - startedAt;
    const tests = checkTests(result, config);
    failures.push(...tests.failures);
    out(`  ${tests.summary.pass}/${tests.summary.tests} passing`);
    if (tests.failures.length > 0) {
      failingTests = extractFailures(result.output);
      if (failingTests === '') out(tailOutput(result.output, 25, 2500));
    }
    if (tests.failures.length === 0 && config.replicates > 1) {
      if (fast) out('  replicates: skipped (--fast); the full run is the definition of done');
      else failures.push(...await checkReplicates(root, config, result, out));
    }

    out('[2/5] source coverage');
    failures.push(...checkCoverage(root, config, covDir, out));
    out('[3/5] test quality');
    const quality = checkTestQuality(root, config);
    failures.push(...quality);
    out(quality.length === 0 ? '  ok' : quality.map((q) => `  ${q}`).join('\n'));

    out('[4/5] hidden holdout set');
    if (!config.holdout) out('  holdout: not configured');
    else if (fast) out('  holdout: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  holdout: skipped until the checks above pass');
    else failures.push(...await checkHoldout(root, config, out));

    out('[5/5] mutation spot-check');
    if (fast) out('  mutation: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  mutation: skipped until the checks above pass');
    else failures.push(...await checkMutation(root, config, baselineMs, out));
  } finally {
    removeTemp(covDir);
  }
  out(failures.length === 0 ? 'VERIFY PASSED' : `VERIFY FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  if (failingTests !== '') out(`\nFailing tests (fix these at the root cause):\n${failingTests}`);
  return { pass: failures.length === 0, failures };
}

module.exports = { strongVerify, loadConfig, mutationTimeoutMs, cleanupTempDirs };
