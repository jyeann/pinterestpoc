'use strict';
const { spawn } = require('node:child_process');

// Must stay below the hook timeouts in .claude/settings.json (700s), or the hook is killed mid-verify.
const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const KILL_GRACE_MS = 2_000;

// NODE_TEST_CONTEXT would make a nested `node --test` think it is a child reporter and print no summary.
function childEnv(extra = {}) {
  const { NODE_TEST_CONTEXT, ...rest } = process.env;
  return { ...rest, ...extra };
}

// Runs in its own process group so a timeout kills the whole tree (test runners, dev servers),
// not just the shell. Resolves even if a grandchild keeps the output pipes open.
function runVerify(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], { cwd, env: childEnv(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    let settled = false;

    const collect = (chunk) => { output = (output + chunk).slice(-MAX_OUTPUT_CHARS); };
    child.stdout.setEncoding('utf8').on('data', collect);
    child.stderr.setEncoding('utf8').on('data', collect);

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ pass: !timedOut && code === 0, output, timedOut });
    };
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      setTimeout(() => finish(null), KILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => { output += `\n${err.message}`; finish(1); });
    child.on('close', (code) => { killGroup(); finish(code); });
  });
}

module.exports = { runVerify, DEFAULT_TIMEOUT_MS };
