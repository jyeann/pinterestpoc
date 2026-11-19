'use strict';
const fs = require('node:fs');
const path = require('node:path');

const STATE_DIR = '.harness';
const STATE_FILE = 'state.json';
const DEFAULTS = Object.freeze({ maxIterations: 20, stallLimit: 3 });
// The gate itself: an agent that can edit these can redefine "done". Always read-only during a run.
const GATE_PATHS = Object.freeze(['verify.config.json', 'acceptance/', 'spec.md']);

const statePath = (projectDir) => path.join(projectDir, STATE_DIR, STATE_FILE);

function readState(projectDir) {
  const file = statePath(projectDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupt ${STATE_DIR}/${STATE_FILE}: ${err.message}`);
  }
}

function writeState(projectDir, state) {
  const file = statePath(projectDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function normaliseProtected(entries, projectDir) {
  return entries.map((entry) => {
    let p = entry.replace(/^\.\//, '');
    if (path.isAbsolute(p)) {
      if (!projectDir || !p.startsWith(`${projectDir}/`)) throw new Error(`Protected path must be inside the project: ${entry}`);
      p = p.slice(projectDir.length + 1);
    }
    return p;
  });
}

// Hidden paths are absolute so they can live outside the project (the safest place for a holdout set).
function normaliseHidden(entries, projectDir) {
  return entries.map((entry) => {
    const p = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    return path.isAbsolute(p) ? p : path.join(projectDir ?? process.cwd(), p);
  });
}

function withGatePaths(entries) {
  return [...entries, ...GATE_PATHS.filter((p) => !entries.includes(p))];
}

function buildState({ verifyCommand, task = '', taskFile = '', diagnose = true, hiddenPaths = [], maxMinutes = null, noProgressLimit = null, startedAt = Date.now(), checkpoint = true, checkpointPush = false, maxIterations, stallLimit, protectedPaths = [], commitGate = true, verifyTimeoutMs, lintCommand, projectDir }) {
  if (!verifyCommand || !verifyCommand.trim()) {
    throw new Error('A non-empty verify command is required: it is the objective definition of done.');
  }
  if (verifyTimeoutMs !== undefined && !(Number.isInteger(verifyTimeoutMs) && verifyTimeoutMs > 0)) {
    throw new Error('verifyTimeoutMs must be a positive integer (milliseconds).');
  }
  const hidden = normaliseHidden(hiddenPaths, projectDir);
  const root = projectDir ? `${projectDir}/` : null;
  const hiddenInside = root ? hidden.filter((h) => h.startsWith(root)).map((h) => `${h.slice(root.length)}/`) : [];
  return {
    active: true,
    status: 'running',
    task,
    taskFile,
    checkpoint,
    checkpointPush,
    verifyCommand: verifyCommand.trim(),
    maxIterations: maxIterations ?? DEFAULTS.maxIterations,
    stallLimit: stallLimit ?? DEFAULTS.stallLimit,
    diagnose,
    maxMinutes,
    noProgressLimit,
    startedAt,
    bestFailing: null,
    sinceImprovement: 0,
    hiddenPaths: hidden,
    protectedPaths: withGatePaths([...new Set([...normaliseProtected(protectedPaths, projectDir), ...hiddenInside])]),
    commitGate,
    ...(verifyTimeoutMs ? { verifyTimeoutMs } : {}),
    ...(lintCommand?.trim() ? { lintCommand: lintCommand.trim() } : {}),
    iteration: 0,
    lastSignature: null,
    stallCount: 0,
    history: [],
  };
}

module.exports = { readState, writeState, buildState, statePath, STATE_DIR };
