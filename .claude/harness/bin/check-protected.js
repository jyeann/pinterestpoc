#!/usr/bin/env node
'use strict';
// CI backstop: fail a PR that changes the gate (acceptance tests, verify config, .claude/, workflows).
// The in-session hooks stop the agent from editing these; this catches it if a hook was bypassed.
const { spawnSync } = require('node:child_process');
const { DEFAULT_PROTECTED, parseProtectedList, changedProtected } = require('../lib/protected');

function parseArgs(argv) {
  const opts = { base: null, head: 'HEAD' };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--base') opts.base = argv[i + 1];
    else if (argv[i] === '--head') opts.head = argv[i + 1];
    else throw new Error(`Unknown argument: ${argv[i]}`);
    if (argv[i + 1] === undefined) throw new Error(`Missing value for ${argv[i]}`);
  }
  if (!opts.base) throw new Error('Usage: check-protected --base <ref> [--head <ref>]');
  return opts;
}

// The extra paths come from the BASE ref: a PR must not be able to shrink its own protection.
function baseList(base) {
  const shown = spawnSync('git', ['show', `${base}:.harness-protected`], { encoding: 'utf8' });
  return shown.status === 0 ? parseProtectedList(shown.stdout) : [];
}

function main() {
  const { base, head } = parseArgs(process.argv.slice(2));
  // -z: git otherwise C-quotes non-ASCII names ("caf\303\251"), which would dodge the prefix match.
  const diff = spawnSync('git', ['diff', '-z', '--name-only', '--no-renames', `${base}...${head}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (diff.status !== 0) throw new Error(`git diff against "${base}" failed: ${diff.stderr.trim()}`);

  const list = [...new Set([...DEFAULT_PROTECTED, ...baseList(base)])];
  const hits = changedProtected(diff.stdout.split('\0').filter(Boolean), list);
  if (hits.length === 0) { console.log(`ok: no protected files changed (${list.length} protected paths)`); return 0; }

  console.log('Protected files changed:');
  for (const f of hits) console.log(`  - ${f}`);
  console.log('\nThese files define "done" and the guardrails. Only a human repository admin should merge this,');
  console.log('after reading the diff, using the ruleset bypass. There is deliberately no label override.');
  return 1;
}

try { process.exitCode = main(); } catch (err) { console.error(`check-protected: ${err.message}`); process.exitCode = 2; }
