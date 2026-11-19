#!/usr/bin/env node
'use strict';
// Claude Code status line command: reads session JSON on stdin, prints one line. Never fails.
const { renderStatusline } = require('../lib/statusline');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw) || {};
  } catch {
    input = {};
  }
  let line;
  try {
    line = renderStatusline(input);
  } catch {
    line = 'tokens: n/a';
  }
  console.log(line);
});
