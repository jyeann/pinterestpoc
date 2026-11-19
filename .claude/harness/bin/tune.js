#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseCandidates, runTune, DEFAULT_CANDIDATES, DEFAULT_AGENT_CMD } = require('../lib/tune');

const USAGE = `tune --task-file <spec> --verify "<cmd>" [--candidates "model:effort,..."] [--trials N] [--min-pass-rate 0-1]
     [--agent-cmd "<cmd using $HARNESS_MODEL $HARNESS_EFFORT $HARNESS_PROMPT_FILE>"] [--agent-timeout-min N]
Runs the task once per candidate in a throwaway git worktree of HEAD (commit your spec and acceptance tests first),
grades each with the verify command, and prints the cheapest candidate that passes. Costs real tokens.`;

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`Bad arguments near ${argv[i]}\n${USAGE}`);
    f[argv[i].slice(2)] = argv[i + 1];
  }
  return f;
}

const num = (v) => (v === null || v === undefined ? 'n/a' : Math.round(v).toLocaleString('en-US'));
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
const money = (v) => (v === null ? 'n/a' : `$${v.toFixed(2)}`);

async function main(argv) {
  const f = parseArgs(argv);
  if (!f.verify || !f['task-file']) throw new Error(USAGE);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const trials = Number.parseInt(f.trials ?? '1', 10);
  const minPassRate = Number(f['min-pass-rate'] ?? '1');
  if (!Number.isInteger(trials) || trials < 1) throw new Error('--trials must be a positive integer');
  if (!(minPassRate > 0 && minPassRate <= 1)) throw new Error('--min-pass-rate must be in (0, 1]');

  const report = await runTune(projectDir, {
    candidates: parseCandidates(f.candidates ?? DEFAULT_CANDIDATES),
    verifyCommand: f.verify,
    taskText: fs.readFileSync(path.resolve(projectDir, f['task-file']), 'utf8').trim(),
    agentCmd: f['agent-cmd'] ?? DEFAULT_AGENT_CMD,
    agentTimeoutMin: f['agent-timeout-min'] ? Number(f['agent-timeout-min']) : undefined,
    trials,
    minPassRate,
    onProgress: ({ candidate, trial, trials: n, run }) => console.error(`  ${candidate.model}:${candidate.effort} trial ${trial}/${n}: ${run.pass ? 'PASS' : 'FAIL'} ${run.seconds.toFixed(0)}s ${money(run.costUsd)}`),
  });

  console.log('model:effort                       pass   mean cost   mean time');
  for (const r of report.results) console.log(`${`${r.model}:${r.effort}`.padEnd(34)} ${`${Math.round(r.passRate * 100)}%`.padEnd(6)} ${money(r.meanCostUsd).padEnd(11)} ${r.meanSeconds.toFixed(0)}s`);
  console.log('\ntokens per run (mean): turns | output | fresh input | cache read | cache write | cache hit');
  for (const r of report.results) console.log(`${`${r.model}:${r.effort}`.padEnd(34)} ${num(r.meanTurns)} | ${num(r.meanOutputTokens)} | ${num(r.meanInputTokens)} | ${num(r.meanCacheReadTokens)} | ${num(r.meanCacheCreateTokens)} | ${pct(r.cacheHitRatio)}`);
  console.log(report.best
    ? `\nCheapest passing at >=${Math.round(minPassRate * 100)}%: ${report.best.model}:${report.best.effort}`
    : `\nNo candidate reached a ${Math.round(minPassRate * 100)}% pass rate. Fix the eval or the spec before tuning cost.`);
  fs.mkdirSync(path.join(projectDir, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.harness', 'tune-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report.best ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => { console.error(`tune: ${err.message}`); process.exitCode = 2; });
