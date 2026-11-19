'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readState } = require('./state');
const { recordHookError } = require('./trace');

function readEvent() {
  const raw = fs.readFileSync(0, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

const projectDirOf = (event) => process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();

// Guardrail context: whether a harness run is active and which extra paths are read-only.
const hiddenDir = () => (process.env.HARNESS_HIDDEN_DIR ? path.resolve(process.env.HARNESS_HIDDEN_DIR) : null);

// Corrupt state is treated as an active run: a damaged state file must tighten guards, never disable them.
function guardContext(projectDir) {
  try {
    const state = readState(projectDir);
    return { state, active: Boolean(state?.active), protectedPaths: state?.protectedPaths ?? [], hiddenPaths: state?.hiddenPaths ?? [], projectDir, hiddenDir: hiddenDir(), corrupt: false };
  } catch (err) {
    process.stderr.write(`[harness] ${err.message}; guards stay on.\n`);
    return { state: null, active: true, protectedPaths: [], hiddenPaths: [], projectDir, hiddenDir: hiddenDir(), corrupt: true };
  }
}

// Hooks fail open: a crashing guard must not brick the session. The error is logged for the human.
function failOpen(name, err) {
  recordHookError(name, err);
  process.stderr.write(`[harness:${name}] internal error, allowing: ${err.message}\n`);
  process.exit(1);
}

module.exports = { readEvent, projectDirOf, guardContext, failOpen };
