'use strict';
// Finds references inside commands, agents, skills and rules that point at files which do not exist.
// A dangling reference makes an agent try, fail and work around it: wasted calls and confusion.
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = /(?<![\w./-])(?:\.\/)?scripts\/[A-Za-z0-9_./-]+\.(?:js|sh|py|ts)\b/g;
const SKILL = /\bskills\/([a-z][a-z0-9-]+)\//g;
const RULE_DIR = /\brules\/([a-z][a-z0-9-]*)\//g;
const AGENT_TYPE = /subagent_type[:=]\s*["']([A-Za-z0-9:_-]+)["']/g;
const SLASH_COMMAND = /(?<![\w/.:-])\/([a-z][a-z0-9]+(?:-[a-z0-9]+)*)\b/g;
// Intentional mentions: optional helpers each document a manual fallback. Keep this list short and justified.
const ALLOWED_SCRIPTS = new Set([
  'scripts/hooks/suggest-compact.js', // strategic-compact: optional hook, skill works without it
  'scripts/check-evidence.js', // frontend-design-direction: optional evidence checker
  'scripts/gan-harness.sh', // gan-style-harness: states the wrapper is not installed
]);

const list = (dir, ext) => { try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)); } catch { return []; } };
const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

function sources(claudeDir) {
  const out = [];
  for (const kind of ['commands', 'agents']) for (const f of list(path.join(claudeDir, kind), '.md')) out.push(path.join(kind, f));
  for (const d of dirs(path.join(claudeDir, 'skills'))) out.push(path.join('skills', d, 'SKILL.md'));
  const walk = (rel) => {
    const abs = path.join(claudeDir, rel);
    for (const f of list(abs, '.md')) out.push(path.join(rel, f));
    for (const d of dirs(abs)) walk(path.join(rel, d));
  };
  walk('rules');
  return out.filter((f) => fs.existsSync(path.join(claudeDir, f)));
}

function checkRefs(claudeDir) {
  // `learned` is the on-demand output folder of /learn, not a shipped skill.
  const skills = new Set([...dirs(path.join(claudeDir, 'skills')), 'learned']);
  const agents = new Set(list(path.join(claudeDir, 'agents'), '.md').map((f) => f.slice(0, -3)));
  const commands = new Set(list(path.join(claudeDir, 'commands'), '.md').map((f) => f.slice(0, -3)));
  const ruleDirs = new Set(dirs(path.join(claudeDir, 'rules')));
  const problems = [];
  for (const file of sources(claudeDir)) {
    fs.readFileSync(path.join(claudeDir, file), 'utf8').split('\n').forEach((line, i) => {
      if (/https?:\/\//.test(line)) return;
      const add = (what) => problems.push(`${file}:${i + 1} ${what}`);
      for (const m of line.matchAll(SCRIPT)) if (!ALLOWED_SCRIPTS.has(m[0].replace(/^\.\//, ''))) add(`missing script ${m[0]}`);
      for (const m of line.matchAll(SKILL)) if (!skills.has(m[1])) add(`missing skill ${m[1]}`);
      for (const m of line.matchAll(RULE_DIR)) if (!ruleDirs.has(m[1])) add(`missing rules dir ${m[1]}`);
      for (const m of line.matchAll(AGENT_TYPE)) if (!agents.has(m[1]) && !['general-purpose', 'Explore', 'Plan'].includes(m[1])) add(`missing agent ${m[1]}`);
      for (const m of line.matchAll(/\becc:[a-z-]+/g)) add(`plugin-scoped name ${m[0]} (agents here use bare names)`);
      if (file.startsWith('commands/') || file.startsWith('agents/') || file.startsWith('skills/')) {
        for (const m of line.matchAll(SLASH_COMMAND)) {
          if (REMOVED.has(m[1]) && !commands.has(m[1]) && !skills.has(m[1])) add(`missing command /${m[1]}`);
        }
      }
    });
  }
  return problems;
}

// Commands removed on purpose; any remaining mention is a dangling pointer.
const REMOVED = new Set([
  'evolve', 'instinct-status', 'instinct-import', 'instinct-export', 'skill-health', 'plan-canvas', 'multi-plan', 'multi-workflow',
  'multi-backend', 'multi-execute', 'multi-frontend', 'quality-gate', 'harness-audit', 'ecc-guide', 'astra-review', 'santa-loop',
  'epic-claim', 'epic-sync', 'epic-validate', 'epic-publish', 'epic-review', 'epic-decompose', 'epic-unblock', 'project-init',
  'setup-pm', 'auto-update', 'skill-host-compat', 'issue-review', 'token-card',
]);

module.exports = { checkRefs };
