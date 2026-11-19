#!/usr/bin/env node
'use strict';
// Usage: node .claude/harness/bin/agents-kpi.js [--out file.json] [--interventions list.json] [--tune tune-report.json] [--finals agent-runs.json] [--human-corrected file.json] [--tune-phases effort-by-phase.json]   Prints the per-agent KPI roll-up as JSON.
const fs = require('node:fs');
const path = require('node:path');
const { buildKpi } = require('../lib/agents-kpi');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const i = process.argv.indexOf('--out');
const f = process.argv.indexOf('--finals');
// A JSON array of completion-notice figures for background agents (see lib/agents-kpi.js applyFinals).
const finals = f > -1 && process.argv[f + 1] ? JSON.parse(fs.readFileSync(process.argv[f + 1], 'utf8')) : [];
const kpi = buildKpi(root, path.join(root, '.claude', 'agents'), { finals });
const j = process.argv.indexOf('--interventions');
// Interventions from before the human-prompt hook existed: a hand-kept JSON array, shown as such.
if (j > -1 && process.argv[j + 1]) kpi.knownInterventions = JSON.parse(fs.readFileSync(process.argv[j + 1], 'utf8'));
const h = process.argv.indexOf('--human-corrected');
// {humanPrompts, interventions, note}: a hand-corrected human count for sessions recorded before prompts were classified.
if (h > -1 && process.argv[h + 1]) { const c = JSON.parse(fs.readFileSync(process.argv[h + 1], 'utf8')); kpi.human = { ...kpi.human, prompts: c.humanPrompts, interventions: c.interventions, corrected: true, note: c.note }; }
const t = process.argv.indexOf('--tune');
// A tune-report.json from tune.js: model x effort pass rate, cost and time on a fixed task.
if (t > -1 && process.argv[t + 1]) kpi.tune = JSON.parse(fs.readFileSync(process.argv[t + 1], 'utf8')).results;
const tp = process.argv.indexOf('--tune-phases');
// effort-by-phase.json: per-phase model x effort pass rate, cost and time from the per-phase tune kit.
if (tp > -1 && process.argv[tp + 1]) kpi.tunePhases = JSON.parse(fs.readFileSync(process.argv[tp + 1], 'utf8')).rows;
const json = JSON.stringify(kpi, null, 2);
if (i > -1 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], json + '\n'); else process.stdout.write(json + '\n');
