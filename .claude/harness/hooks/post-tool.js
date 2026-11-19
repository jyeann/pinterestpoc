#!/usr/bin/env node
'use strict';
// Records every tool call (success or failure) to the session trace. Observation only: it never blocks.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { logToolEvent } = require('../lib/trace');

try {
  const event = readEvent();
  logToolEvent(projectDirOf(event), event);
} catch { /* tracing is best-effort */ }
