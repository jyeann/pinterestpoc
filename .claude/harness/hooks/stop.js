#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { readState, writeState } = require('../lib/state');
const { runVerify } = require('../lib/verify');
const { decideStop } = require('../lib/stop-loop');
const { writeCheckpoint } = require('../lib/checkpoint');
const { REPORT_FILE } = require('../lib/failure-cluster');
const { logStop } = require('../lib/trace');

// Best effort: a checkpoint problem must never change the loop's decision.
function checkpoint(projectDir, state, nextState) {
  if (state.checkpoint === false) return;
  const r = writeCheckpoint(projectDir, { message: `harness wip: ${nextState.status}, iteration ${state.iteration}`, push: state.checkpointPush === true });
  if (r.status === 'created') process.stderr.write(`[harness] checkpoint ${r.commit.slice(0, 8)} -> ${r.ref}${state.checkpointPush ? (r.pushed ? ' (pushed)' : ' (push failed)') : ''}\n`);
  else if (r.status === 'error') process.stderr.write(`[harness] checkpoint failed: ${r.reason}\n`);
}

// A corrupt state file must not silently end enforcement: block once, then let the session end
// (the agent cannot repair .harness/, so blocking forever would loop).
function corruptState(event, err) {
  if (event.stop_hook_active) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `Harness state is corrupt (${err.message}). Stop and tell the human to repair or remove .harness/state.json; do not continue working.` }));
}

async function main() {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  logStop(projectDir, event);
  let state;
  try {
    state = readState(projectDir);
  } catch (err) {
    return corruptState(event, err);
  }
  if (!state?.active) return;

  const report = path.join(projectDir, REPORT_FILE);
  // The diagnosis turn is bounded and needs no verify run.
  const result = state.diagnosing ? null : await runVerify(state.verifyCommand, { cwd: projectDir, timeoutMs: state.verifyTimeoutMs });
  const diagnosisWritten = fs.existsSync(report) && fs.statSync(report).size > 0;
  const { decision, reason, nextState } = decideStop(state, result, { diagnosisWritten, now: Date.now() });
  // A report left over from an earlier run must not count as this run's diagnosis.
  if (nextState.diagnosing && !state.diagnosing) fs.rmSync(report, { force: true });
  writeState(projectDir, nextState);
  checkpoint(projectDir, state, nextState);

  if (decision === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  else process.stderr.write(`[harness] run ended: ${nextState.status}. ${reason}\n`);
}

main().catch((err) => failOpen('stop', err));
