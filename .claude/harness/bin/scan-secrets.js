#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { scanFiles, scanHistory, markerLines, markerContents } = require('../lib/secret-scan');

const args = process.argv.slice(2);
const histIdx = args.indexOf('--history');
const base = histIdx >= 0 ? args[histIdx + 1] : null;
if (histIdx >= 0 && !base) { console.error('scan-secrets: --history needs a base ref'); process.exit(2); }

const git = (...a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const ls = git('ls-files', '-z');
if (ls.status !== 0) { console.error(`scan-secrets: git ls-files failed: ${ls.stderr.trim()}`); process.exit(2); }
const files = ls.stdout.split('\0').filter(Boolean);

const found = scanFiles(process.cwd(), files);
for (const f of found) console.log(`${f.file}:${f.line}: possible ${f.kinds.join(', ')}`);

let historyFound = [];
if (base) {
  const log = git('log', '-p', '--no-color', '--no-renames', `${base}..HEAD`);
  if (log.status !== 0) { console.error(`scan-secrets: git log ${base}..HEAD failed: ${log.stderr.trim()}`); process.exit(2); }
  historyFound = scanHistory(log.stdout, markerContents(process.cwd(), files));
  for (const f of historyFound) console.log(`history: commit ${f.commit} ${f.file}: possible ${f.kinds.join(', ')} (rotate it even if later removed)`);
}

const markers = markerLines(process.cwd(), files);
if (markers.length > 0) console.log(`allow-secret markers (reviewer: confirm each is a fixture): ${markers.join(', ')}`);

if (found.length + historyFound.length === 0) { console.log('ok: no secrets found'); process.exit(0); }
console.log('\nUse an environment variable, or mark a deliberate fixture line with "harness:allow-secret".');
process.exit(1);
