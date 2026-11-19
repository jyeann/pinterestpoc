#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { checkRefs } = require('../lib/refs');

const claudeDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..', '..');
const problems = checkRefs(claudeDir);
if (problems.length === 0) console.log('check-refs: no dangling references.');
else {
  console.error(`check-refs: ${problems.length} dangling reference(s). Remove them or ship the target.\n${problems.join('\n')}`);
  process.exit(1);
}
