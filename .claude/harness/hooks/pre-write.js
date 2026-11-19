#!/usr/bin/env node
'use strict';
const { readEvent, projectDirOf, guardContext, failOpen } = require('../lib/hook-io');
const { checkWrite } = require('../lib/guards');
const { logBlocked } = require('../lib/trace');

try {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  const verdict = checkWrite(event, guardContext(projectDir), projectDir);
  if (verdict.block) {
    logBlocked(projectDir, event, verdict.reason);
    process.stderr.write(`[harness] BLOCKED: ${verdict.reason}\n`);
    process.exit(2);
  }
} catch (err) {
  failOpen('pre-write', err);
}
