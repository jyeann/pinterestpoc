'use strict';
// Status line: shows the exact number of tokens in the current context, so you
// know how close the session is to the "dumb zone" (quality degrades as context grows).
const fs = require('node:fs');

const SMART_ZONE_TOKENS = 100000;
const TAIL_BYTES = 256 * 1024;

function sumUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const parts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens];
  if (!parts.some((n) => Number.isFinite(n))) return null;
  return parts.reduce((total, n) => total + (Number.isFinite(n) ? n : 0), 0);
}

function readTail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, size - length);
    const text = buf.toString('utf8', 0, bytesRead);
    // The window may start mid-line: drop that partial first line.
    return size > length ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

function tokensFromTranscript(file) {
  let text;
  try {
    text = readTail(file);
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!entry || entry.type !== 'assistant' || entry.isSidechain) continue;
    if (entry.message && entry.message.model === '<synthetic>') continue;
    const total = sumUsage(entry.message && entry.message.usage);
    if (total) return total; // skips null and zero-usage entries
  }
  return null;
}

function contextTokens(input) {
  const fromUsage = sumUsage(input.context_window && input.context_window.current_usage);
  if (fromUsage !== null) return fromUsage;
  return input.transcript_path ? tokensFromTranscript(input.transcript_path) : null;
}

function renderStatusline(input) {
  const model = input.model && input.model.display_name;
  const tokens = contextTokens(input);
  const parts = [];
  if (model) parts.push(model);
  if (tokens === null) {
    parts.push('tokens: n/a');
    return parts.join(' | ');
  }
  const size = input.context_window && input.context_window.context_window_size;
  const pct = Number.isFinite(size) && size > 0 ? ` (${Math.round((tokens / size) * 100)}%)` : '';
  parts.push(`${tokens.toLocaleString('en-US')} tokens${pct}`);
  if (tokens > SMART_ZONE_TOKENS) parts.push('⚠ dumb zone: clear or split the task');
  return parts.join(' | ');
}

module.exports = { contextTokens, renderStatusline, SMART_ZONE_TOKENS };
