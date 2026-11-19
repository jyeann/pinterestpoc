'use strict';
// Model x effort search on the verify gate: run the same task with each candidate in an isolated git worktree,
// grade with the verify command, and pick the cheapest candidate that still passes. A stronger model at low
// effort often finishes in fewer tokens than a weaker one at high effort, but only an eval can tell you.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runVerify } = require('./verify');

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const DEFAULT_CANDIDATES = 'claude-opus-5-5:low,claude-sonnet-5-5:low,claude-sonnet-5-5:high';
const DEFAULT_AGENT_CMD = 'claude -p --model "$HARNESS_MODEL" --effort "$HARNESS_EFFORT" --output-format json --permission-mode auto "$(cat "$HARNESS_PROMPT_FILE")"';
const MINUTE_MS = 60_000;

function parseCandidates(text) {
  const parts = String(text).split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error('At least one candidate (model:effort) is required');
  return parts.map((part) => {
    const at = part.lastIndexOf(':');
    const model = at > 0 ? part.slice(0, at) : '';
    const effort = at > 0 ? part.slice(at + 1) : '';
    if (!model || !effort) throw new Error(`Candidate "${part}" must look like model:effort`);
    if (!EFFORTS.has(effort)) throw new Error(`Unknown effort "${effort}" in "${part}" (use ${[...EFFORTS].join(', ')})`);
    return { model, effort };
  });
}

function parseCost(output) {
  const found = [...output.matchAll(/"total_cost_usd"\s*:\s*([0-9]*\.?[0-9]+)/g)];
  return found.length > 0 ? Number(found[found.length - 1][1]) : null;
}

// Last JSON result line from `claude -p --output-format json`.
function parseUsage(output) {
  for (const line of output.split('\n').reverse()) {
    if (!line.startsWith('{') || !line.includes('"usage"')) continue;
    try {
      const j = JSON.parse(line);
      const u = j.usage ?? {};
      return { turns: j.num_turns ?? null, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheCreate: u.cache_creation_input_tokens ?? 0 };
    } catch { /* not the result line */ }
  }
  return null;
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

function summarise(candidate, trials) {
  const costs = trials.map((t) => t.costUsd).filter((c) => typeof c === 'number');
  const usages = trials.map((t) => t.usage).filter(Boolean);
  const avg = (key) => mean(usages.map((u) => u[key]).filter((v) => typeof v === 'number'));
  const total = (key) => usages.reduce((n, u) => n + (u[key] ?? 0), 0);
  const prompt = total('input') + total('cacheRead') + total('cacheCreate');
  return {
    ...candidate,
    meanTurns: avg('turns'),
    meanInputTokens: avg('input'),
    meanOutputTokens: avg('output'),
    meanCacheReadTokens: avg('cacheRead'),
    meanCacheCreateTokens: avg('cacheCreate'),
    cacheHitRatio: prompt > 0 ? total('cacheRead') / prompt : null,
    trials: trials.length,
    passRate: trials.filter((t) => t.pass).length / trials.length,
    meanCostUsd: mean(costs),
    meanSeconds: mean(trials.map((t) => t.seconds)),
  };
}

function pickBest(rows, minPassRate) {
  const eligible = rows.filter((r) => r.passRate > 0 && r.passRate >= minPassRate);
  const byCostThenTime = (a, b) => (a.meanCostUsd ?? Infinity) - (b.meanCostUsd ?? Infinity) || a.meanSeconds - b.meanSeconds;
  const noCost = (a, b) => a.meanSeconds - b.meanSeconds;
  return [...eligible].sort((a, b) => (a.meanCostUsd === null && b.meanCostUsd === null ? noCost(a, b) : byCostThenTime(a, b)))[0] ?? null;
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function runTrial(projectDir, candidate, opts) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tune-'));
  const worktree = path.join(scratch, 'wt');
  const promptFile = path.join(scratch, 'prompt.txt');
  fs.writeFileSync(promptFile, `${opts.taskText}\n\nWork until this command exits 0: ${opts.verifyCommand}\nDo not ask questions; there is no human.\n`);
  git(projectDir, ['worktree', 'add', '--quiet', '--detach', worktree, 'HEAD']);
  const started = Date.now();
  try {
    const agent = await runVerify(opts.agentCmd, {
      cwd: worktree,
      timeoutMs: (opts.agentTimeoutMin ?? 30) * MINUTE_MS,
      env: { HARNESS_MODEL: candidate.model, HARNESS_EFFORT: candidate.effort, HARNESS_PROMPT_FILE: promptFile },
    });
    const seconds = (Date.now() - started) / 1000;
    const verify = await runVerify(opts.verifyCommand, { cwd: worktree, timeoutMs: (opts.verifyTimeoutMin ?? 10) * MINUTE_MS });
    return { pass: verify.pass, costUsd: parseCost(agent.output), usage: parseUsage(agent.output), seconds, agentTimedOut: agent.timedOut };
  } finally {
    try { git(projectDir, ['worktree', 'remove', '--force', worktree]); } catch { fs.rmSync(worktree, { recursive: true, force: true }); }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function runTune(projectDir, opts) {
  try { git(projectDir, ['rev-parse', '--git-dir']); } catch { throw new Error('tune needs a git repository (each candidate runs in its own worktree of HEAD)'); }
  const { candidates, trials = 1, minPassRate = 1, onProgress = () => {} } = opts;
  const results = [];
  for (const candidate of candidates) {
    const runs = [];
    for (let i = 0; i < trials; i += 1) {
      runs.push(await runTrial(projectDir, candidate, opts));
      onProgress({ candidate, trial: i + 1, trials, run: runs[runs.length - 1] });
    }
    results.push(summarise(candidate, runs));
  }
  return { results, best: pickBest(results, minPassRate), minPassRate };
}

module.exports = { parseCandidates, parseCost, parseUsage, summarise, pickBest, runTune, DEFAULT_CANDIDATES, DEFAULT_AGENT_CMD };
