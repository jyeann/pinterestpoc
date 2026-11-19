#!/usr/bin/env node
'use strict';
// Records that a human sent a prompt (length only, never the text). Observation only: it never blocks.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { logHuman } = require('../lib/trace');

try {
  const event = readEvent();
  logHuman(projectDirOf(event), event);
} catch { /* tracing is best-effort */ }
