#!/usr/bin/env node
'use strict';
// PostToolUse(Write|Edit): runs the run's lint command after each edit. Exit 2 feeds the output back to the agent.
// Exit 1 would be a non-blocking error, so a failing lint must exit 2. Inert unless a run set a lint command.
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { readState } = require('../lib/state');
const { runVerify } = require('../lib/verify');
const { tailOutput } = require('../lib/stop-loop');

const LINT_TIMEOUT_MS = 50_000;

async function main() {
  const projectDir = projectDirOf(readEvent());
  const state = readState(projectDir);
  if (!state?.active || !state.lintCommand) return;

  const result = await runVerify(state.lintCommand, { cwd: projectDir, timeoutMs: LINT_TIMEOUT_MS });
  if (result.pass) return;
  process.stderr.write(`[harness] lint failed${result.timedOut ? ' (timed out)' : ''}; fix before continuing.\n${tailOutput(result.output)}\n`);
  process.exit(2);
}

main().catch((err) => failOpen('post-edit', err));
