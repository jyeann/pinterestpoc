#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { readState, writeState, buildState } = require('../lib/state');
const { runVerify } = require('../lib/verify');
const { tailOutput } = require('../lib/stop-loop');
const { writeCheckpoint, restoreCheckpoint } = require('../lib/checkpoint');
const { preflightForProject } = require('../lib/preflight');

const USAGE = `harness <command>
  init --verify "<cmd>" [--task "<text>"] [--task-file <f>] [--max N] [--stall N] [--protect a/,b/] [--verify-timeout SECONDS] [--lint "<cmd>"] [--no-commit-gate]
        [--no-checkpoint] [--checkpoint-push] [--require-sandbox]\n        [--hide <paths>] [--no-diagnosis]\n        [--max-minutes N] [--no-progress N]
  checkpoint    snapshot the worktree to refs/harness/wip/<branch> now (the Stop hook does this every iteration)
  restore       copy the latest checkpoint's files back into the worktree (fetches from origin if needed)
  status        show the current run
  verify        run the verify command once (does not change state)
  off           deactivate the run (humans only; blocked for the agent while a run is active)`;

const BOOLEAN_FLAGS = new Set(['no-commit-gate', 'no-checkpoint', 'checkpoint-push', 'no-diagnosis', 'require-sandbox']);

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    if (BOOLEAN_FLAGS.has(argv[i].slice(2))) { flags[argv[i].slice(2)] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argv[i]}`);
    flags[argv[i].slice(2)] = value;
    i += 1;
  }
  return flags;
}

const toInt = (value, name) => {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
};

async function main([command, ...rest]) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  switch (command) {
    case 'init': {
      const f = parseFlags(rest);
      const task = f['task-file'] ? fs.readFileSync(f['task-file'], 'utf8').trim() : f.task ?? '';
      const state = buildState({
        verifyCommand: f.verify,
        task,
        taskFile: f['task-file'] ?? '',
        diagnose: !f['no-diagnosis'],
        hiddenPaths: f.hide ? f.hide.split(',').map((p) => p.trim()).filter(Boolean) : [],
        checkpoint: !f['no-checkpoint'],
        checkpointPush: Boolean(f['checkpoint-push']),
        maxIterations: toInt(f.max, 'max'),
        stallLimit: toInt(f.stall, 'stall'),
        maxMinutes: toInt(f['max-minutes'], 'max-minutes') ?? null,
        noProgressLimit: toInt(f['no-progress'], 'no-progress') ?? null,
        protectedPaths: f.protect ? f.protect.split(',').map((p) => p.trim()).filter(Boolean) : [],
        commitGate: !f['no-commit-gate'],
        verifyTimeoutMs: f['verify-timeout'] ? toInt(f['verify-timeout'], 'verify-timeout') * 1000 : undefined,
        lintCommand: f.lint,
        projectDir,
      });
      const { warnings, errors } = preflightForProject(projectDir, { requireSandbox: Boolean(f['require-sandbox']) });
      warnings.forEach((w) => console.error(`[harness] WARNING: ${w}`));
      if (errors.length > 0) throw new Error(errors.join(' '));
      writeState(projectDir, state);
      console.log(`Harness run started. Done = \`${state.verifyCommand}\` exits 0 (max ${state.maxIterations} iterations).`);
      return 0;
    }
    case 'status': {
      const state = readState(projectDir);
      console.log(state ? JSON.stringify({ ...state, history: undefined, iterationsRecorded: state.history.length }, null, 2) : 'No harness run.');
      return 0;
    }
    case 'verify': {
      const state = readState(projectDir);
      if (!state) throw new Error('No harness run; run `init` first.');
      const result = await runVerify(state.verifyCommand, { cwd: projectDir, timeoutMs: state.verifyTimeoutMs });
      console.log(result.pass ? 'PASS' : `FAIL${result.timedOut ? ' (timed out)' : ''}\n${tailOutput(result.output)}`);
      return result.pass ? 0 : 1;
    }
    case 'checkpoint': {
      const r = writeCheckpoint(projectDir, { message: 'harness checkpoint (manual)', push: readState(projectDir)?.checkpointPush === true });
      console.log(JSON.stringify(r));
      return r.status === 'error' ? 1 : 0;
    }
    case 'restore': {
      const r = restoreCheckpoint(projectDir);
      console.log(JSON.stringify(r));
      return r.status === 'restored' ? 0 : 1;
    }
    case 'off': {
      const state = readState(projectDir);
      if (state) writeState(projectDir, { ...state, active: false, status: 'stopped-by-human' });
      console.log('Harness run deactivated.');
      return 0;
    }
    default:
      console.error(USAGE);
      return command ? 2 : 0;
  }
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(`harness: ${err.message}`);
    process.exitCode = 2;
  });
