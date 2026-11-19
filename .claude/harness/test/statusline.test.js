'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { contextTokens, renderStatusline, SMART_ZONE_TOKENS } = require('../lib/statusline');

const BIN = path.join(__dirname, '..', 'bin', 'statusline.js');

const usage = (input, cacheRead = 0, cacheCreate = 0) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreate,
  output_tokens: 7,
});

function transcript(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sl-')), 't.jsonl');
  fs.writeFileSync(file, `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`);
  return file;
}

test('contextTokens sums input, cache read and cache creation from current_usage', () => {
  const input = { context_window: { current_usage: usage(1000, 20000, 3000) } };
  assert.equal(contextTokens(input), 24000);
});

test('contextTokens falls back to the last assistant usage in the transcript', () => {
  const file = transcript([
    { type: 'assistant', message: { usage: usage(10, 100, 0) } },
    { type: 'user', message: {} },
    '{not json',
    { type: 'assistant', message: { usage: usage(5, 40000, 500) } },
  ]);
  assert.equal(contextTokens({ transcript_path: file }), 40505);
});

test('contextTokens returns null when nothing is known', () => {
  assert.equal(contextTokens({}), null);
  assert.equal(contextTokens({ transcript_path: '/nonexistent/file.jsonl' }), null);
  assert.equal(contextTokens({ transcript_path: transcript([{ type: 'user' }]) }), null);
});

test('renderStatusline shows exact tokens, model and percentage of the window', () => {
  const out = renderStatusline({
    model: { display_name: 'Sonnet' },
    context_window: { context_window_size: 200000, current_usage: usage(30000, 12000, 0) },
  });
  assert.equal(out, 'Sonnet | 42,000 tokens (21%)');
});

test('renderStatusline warns once past the smart-zone threshold', () => {
  const out = renderStatusline({ context_window: { current_usage: usage(SMART_ZONE_TOKENS + 1) } });
  assert.match(out, /dumb zone/);
  const fine = renderStatusline({ context_window: { current_usage: usage(SMART_ZONE_TOKENS) } });
  assert.doesNotMatch(fine, /dumb zone/);
});

test('renderStatusline degrades to a placeholder when usage is unknown', () => {
  assert.equal(renderStatusline({}), 'tokens: n/a');
  assert.equal(renderStatusline({ model: { display_name: 'Opus' } }), 'Opus | tokens: n/a');
});

test('statusline CLI reads JSON on stdin and prints one line', () => {
  const input = JSON.stringify({ context_window: { current_usage: usage(1234) } });
  const r = spawnSync(process.execPath, [BIN], { input, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '1,234 tokens');
});

test('statusline CLI never fails on empty or invalid stdin', () => {
  for (const input of ['', 'not json']) {
    const r = spawnSync(process.execPath, [BIN], { input, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'tokens: n/a');
  }
});

test('contextTokens skips synthetic, sidechain and zero-usage assistant entries', () => {
  const file = transcript([
    { type: 'assistant', message: { usage: usage(9000, 1000, 0) } },
    { type: 'assistant', isSidechain: true, message: { usage: usage(777) } },
    { type: 'assistant', message: { model: '<synthetic>', usage: usage(555) } },
    { type: 'assistant', message: { usage: usage(0, 0, 0) } },
  ]);
  assert.equal(contextTokens({ transcript_path: file }), 10000);
});

test('contextTokens ignores a partial first line when the transcript is larger than the tail window', () => {
  const filler = { type: 'user', message: { content: 'x'.repeat(300 * 1024) } };
  const file = transcript([{ type: 'assistant', message: { usage: usage(1, 2, 3) } }, filler, { type: 'assistant', message: { usage: usage(40, 50, 60) } }, { type: 'user' }]);
  assert.equal(contextTokens({ transcript_path: file }), 150);
});
