#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { buildReport, renderMarkdown, addMarker } = require('../lib/report');
const { harnessDir } = require('../lib/trace');

const USAGE = `report [--json] [--last N]    score recorded sessions and print what keeps going wrong
report --mark "<label>"       record that you shipped a change (a merged skill or rule), so later reports show before/after`;

function main(argv) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (argv.includes('--help')) { console.log(USAGE); return 0; }
  const markAt = argv.indexOf('--mark');
  if (markAt >= 0) {
    addMarker(projectDir, argv[markAt + 1]);
    console.log(`Marker recorded: ${argv[markAt + 1]}`);
    return 0;
  }
  const lastAt = argv.indexOf('--last');
  const last = lastAt >= 0 ? Number.parseInt(argv[lastAt + 1], 10) : 50;
  if (!Number.isInteger(last) || last < 1) throw new Error('--last must be a positive integer');
  const report = buildReport(projectDir, { last });
  fs.mkdirSync(harnessDir(projectDir), { recursive: true });
  fs.writeFileSync(path.join(harnessDir(projectDir), 'scores.jsonl'), report.sessions.map((s) => JSON.stringify(s)).join('\n') + (report.sessions.length ? '\n' : ''));
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : renderMarkdown(report));
  return 0;
}

try { process.exit(main(process.argv.slice(2))); } catch (err) { process.stderr.write(`report: ${err.message}\n${USAGE}\n`); process.exit(2); }
