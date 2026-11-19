#!/usr/bin/env node
'use strict';
// Usage: next-task.js [TASKS.md] [--json]
// Exit 0: at least one AFK task is ready. Exit 3: nothing for an agent to do
// (ALL_DONE | IN_PROGRESS | NEEDS_HUMAN | STUCK). Exit 2: unreadable or invalid task file.
const fs = require('node:fs');
const { parseTasks, validateTasks, summarise } = require('../lib/tasks');

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--')) || 'TASKS.md';

let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  console.error(`next-task: cannot read ${file}: ${err.message}`);
  process.exit(2);
}

const tasks = parseTasks(text);
const errors = validateTasks(tasks);
if (errors.length > 0) {
  for (const e of errors) console.error(`next-task: ${file}: ${e}`);
  process.exit(2);
}

const result = summarise(tasks);
if (json) console.log(JSON.stringify(result, null, 2));
else if (result.state === 'ready') for (const t of result.ready) console.log(`${t.id}\t${t.title}`);
else console.log(result.state.toUpperCase().replace('-', '_'));
process.exit(result.state === 'ready' ? 0 : 3);
