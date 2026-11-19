'use strict';
// Session trace: one compact JSON line per tool call, guard block and stop, kept under .harness/traces/.
// This is the raw material for scoring. It stores a redacted, truncated summary, never full tool input
// or output, and logging can never fail a tool call (every write is best-effort).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { scanSecrets } = require('./guards');

const STATE_DIR = '.harness';
const MAX_SUMMARY = 200;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const harnessDir = (projectDir) => path.join(projectDir, STATE_DIR);
const tracesDir = (projectDir) => path.join(harnessDir(projectDir), 'traces');
const safeId = (id) => String(id || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80) || 'unknown';

function redact(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (scanSecrets(flat).length > 0) return '[redacted: possible secret]';
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY)}…` : flat;
}

function summarize(event) {
  const input = event.tool_input ?? {};
  const raw = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? '';
  return redact(raw);
}

// Numbers and hex ids change between otherwise identical calls; strip them so repeats collapse.
function signature(tool, summary) {
  const normal = summary.replace(/[0-9a-f]{7,}/gi, '<id>').replace(/\d+/g, '#');
  return crypto.createHash('sha1').update(`${tool}\0${normal}`).digest('hex').slice(0, 12);
}

function append(projectDir, sessionId, record) {
  try {
    fs.mkdirSync(tracesDir(projectDir), { recursive: true });
    fs.appendFileSync(path.join(tracesDir(projectDir), `${safeId(sessionId)}.jsonl`), `${JSON.stringify(record)}\n`);
  } catch { /* tracing must never break a session */ }
}

function logToolEvent(projectDir, event, now = Date.now()) {
  const tool = event.tool_name ?? 'unknown';
  const summary = summarize(event);
  const failed = event.hook_event_name === 'PostToolUseFailure' || Boolean(event.tool_response?.is_error || event.tool_response?.interrupted);
  append(projectDir, event.session_id, { type: 'tool', ts: now, tool, ok: !failed, summary, sig: signature(tool, summary) });
  if (AGENT_TOOLS.has(tool)) logAgentRun(projectDir, event, failed, now);
}

// One record per delegated agent run, for the KPI view: who ran, on which model and effort, what it cost.
// Fields come from the hook payload only; anything the host does not send stays null (never guessed).
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

function logAgentRun(projectDir, event, failed, now) {
  const input = event.tool_input ?? {};
  const out = event.tool_response ?? {};
  const usage = out.usage ?? {};
  const tokens = num(out.totalTokens) ?? (num(usage.input_tokens) !== null || num(usage.output_tokens) !== null ? (num(usage.input_tokens) ?? 0) + (num(usage.output_tokens) ?? 0) : null);
  append(projectDir, event.session_id, {
    type: 'agent', ts: now, ok: !failed,
    agent: redact(input.subagent_type ?? 'general-purpose'),
    phase: (/^\[phase:([\w-]{1,30})\]/.exec(String(input.description ?? '')) ?? [])[1] ?? null,
    task: redact(input.description ?? ''),
    model: input.model ? redact(input.model) : null,
    effort: redact(input.effort ?? process.env.CLAUDE_CODE_EFFORT_LEVEL ?? '') || null,
    tokens, durationMs: num(out.totalDurationMs), toolUses: num(out.totalToolUseCount),
  });
}

function logBlocked(projectDir, event, reason, now = Date.now()) {
  const tool = event.tool_name ?? 'unknown';
  const summary = summarize(event);
  append(projectDir, event.session_id, { type: 'blocked', ts: now, tool, summary, sig: signature(tool, summary), reason: redact(reason) });
}

// One record per human prompt: only its length, never the text. After the first prompt of a session,
// every further prompt is an intervention, which the KPI view counts as a defect of the run's autonomy.
// Agent hand-backs, stop-hook feedback and notifications also arrive as prompts. Count only what is not one of those.
const SYSTEM_PROMPT_MARKERS = ['SYSTEM NOTIFICATION - NOT USER INPUT', '[Subagent hand-back]', '<task-notification', 'Stop hook feedback', 'sent a message while you were working', 'This task fired at'];
const promptKind = (prompt) => (SYSTEM_PROMPT_MARKERS.some((m) => String(prompt ?? '').includes(m)) ? 'system' : 'human');

function logHuman(projectDir, event, now = Date.now()) {
  append(projectDir, event.session_id, { type: 'human', ts: now, chars: String(event.prompt ?? '').length, kind: promptKind(event.prompt) });
}

function logStop(projectDir, event, now = Date.now()) {
  append(projectDir, event.session_id, { type: 'stop', ts: now });
}

function recordHookError(name, err, projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  try {
    fs.mkdirSync(harnessDir(projectDir), { recursive: true });
    fs.appendFileSync(path.join(harnessDir(projectDir), 'hook-errors.jsonl'), `${JSON.stringify({ ts: Date.now(), hook: name, error: redact(err?.message) })}\n`);
  } catch { /* nothing more to do */ }
}

function parseLines(text) {
  return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function readJsonl(file) {
  try { return parseLines(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function readSessions(projectDir) {
  let files = [];
  try { files = fs.readdirSync(tracesDir(projectDir)).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  return files
    .map((f) => ({ id: f.slice(0, -'.jsonl'.length), events: readJsonl(path.join(tracesDir(projectDir), f)) }))
    .filter((s) => s.events.length > 0)
    .map((s) => ({ ...s, ts: Math.max(...s.events.map((e) => e.ts ?? 0)) }))
    .sort((a, b) => a.ts - b.ts);
}

module.exports = {
  logToolEvent, logBlocked, logHuman, promptKind, logStop, recordHookError, readSessions, readJsonl, harnessDir, redact, signature, EDIT_TOOLS,
};
