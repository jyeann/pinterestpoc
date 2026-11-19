'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SANDBOX_TOOLS = ['bwrap', 'socat'];

const hasTool = (name) => spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;

function isTrusted(claudeJson, projectDir) {
  const projects = claudeJson?.projects ?? {};
  for (let dir = path.resolve(projectDir); ; dir = path.dirname(dir)) {
    if (projects[dir]?.hasTrustDialogAccepted === true) return true;
    if (dir === path.dirname(dir)) return false;
  }
}

// Problems that silently weaken an unattended run. Warnings never block; errors do.
function preflight({ settings, claudeJson, hasTool: has = hasTool, projectDir, requireSandbox = false }) {
  const warnings = [];
  const errors = [];

  if (settings?.sandbox?.enabled) {
    const missing = SANDBOX_TOOLS.filter((t) => !has(t));
    if (missing.length > 0) {
      const msg = `settings.json enables the sandbox but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not installed, so Claude Code runs commands WITHOUT filesystem or network limits. Install them, or accept that only the deny rules and shell guards apply.`;
      (requireSandbox ? errors : warnings).push(msg);
    }
  }

  if (!isTrusted(claudeJson, projectDir)) {
    warnings.push('This workspace is not recorded as trusted, so non-interactive runs ignore the project permissions.allow list and the agent cannot run even `node --test` without approval. Open Claude Code here once and accept the trust dialog, or set hasTrustDialogAccepted in ~/.claude.json.');
  }

  return { warnings, errors };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const preflightForProject = (projectDir, options = {}) => preflight({
  settings: readJson(path.join(projectDir, '.claude', 'settings.json')),
  claudeJson: readJson(path.join(os.homedir(), '.claude.json')),
  projectDir,
  ...options,
});

module.exports = { preflight, preflightForProject };
