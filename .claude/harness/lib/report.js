'use strict';
// Aggregates scored sessions into the "what keeps going wrong, and did my fix help" view.
const fs = require('node:fs');
const path = require('node:path');
const { readSessions, readJsonl, harnessDir } = require('./trace');
const { scoreSession } = require('./score');

const TREND_WINDOW = 10;
const TOP_FAILURES = 5;

const rate = (sessions, name) => {
  const results = sessions.flatMap((s) => s.scores.filter((x) => x.name === name));
  return results.length === 0 ? null : results.filter((x) => x.pass).length / results.length;
};
const fmt = (r) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);

function readMarkers(projectDir) {
  return readJsonl(path.join(harnessDir(projectDir), 'markers.jsonl'));
}

function addMarker(projectDir, label, now = Date.now()) {
  if (!label || !label.trim()) throw new Error('A marker needs a label, e.g. the skill or rule you merged.');
  fs.mkdirSync(harnessDir(projectDir), { recursive: true });
  fs.appendFileSync(path.join(harnessDir(projectDir), 'markers.jsonl'), `${JSON.stringify({ ts: now, label: label.trim() })}\n`);
}

function buildReport(projectDir, { last = 50 } = {}) {
  const sessions = readSessions(projectDir).slice(-last).map((s) => ({ id: s.id, ts: s.ts, scores: scoreSession(s.events), events: s.events }));
  const names = [...new Set(sessions.flatMap((s) => s.scores.map((x) => x.name)))];
  const recent = sessions.slice(-TREND_WINDOW);
  const earlier = sessions.slice(-2 * TREND_WINDOW, -TREND_WINDOW);

  const scorers = names.map((name) => ({ name, passRate: rate(sessions, name), recent: rate(recent, name), earlier: rate(earlier, name) }));

  const reasonCounts = new Map();
  for (const s of sessions) {
    for (const score of s.scores) {
      for (const reason of score.reasons) {
        const key = `${score.name}: ${reason}`;
        const entry = reasonCounts.get(key) ?? { text: key, count: 0, sessions: [] };
        reasonCounts.set(key, { ...entry, count: entry.count + 1, sessions: [...entry.sessions, s.id] });
      }
    }
  }
  const topFailures = [...reasonCounts.values()].sort((a, b) => b.count - a.count).slice(0, TOP_FAILURES);

  const markers = readMarkers(projectDir).map((m) => {
    const before = sessions.filter((s) => s.ts < m.ts);
    const after = sessions.filter((s) => s.ts >= m.ts);
    return { ...m, beforeSessions: before.length, afterSessions: after.length, rates: names.map((n) => ({ name: n, before: rate(before, n), after: rate(after, n) })) };
  });

  const hookErrors = readJsonl(path.join(harnessDir(projectDir), 'hook-errors.jsonl'));
  return { sessionCount: sessions.length, scorers, topFailures, markers, hookErrors, sessions: sessions.map(({ id, ts, scores }) => ({ id, ts, scores })) };
}

function renderMarkdown(report) {
  if (report.sessionCount === 0) return '# Harness report\n\nNo sessions recorded yet. Traces appear in `.harness/traces/` once the PostToolUse hook has run.\n';
  const lines = [`# Harness report (${report.sessionCount} sessions)`, '', '## Pass rates', '', '| scorer | overall | last 10 | previous 10 |', '|---|---|---|---|'];
  for (const s of report.scorers) lines.push(`| ${s.name} | ${fmt(s.passRate)} | ${fmt(s.recent)} | ${fmt(s.earlier)} |`);
  lines.push('', '## Most common failures', '');
  if (report.topFailures.length === 0) lines.push('None. Every scorer passed.');
  for (const f of report.topFailures) lines.push(`- (${f.count}x, e.g. session ${f.sessions[0]}) ${f.text}`);
  if (report.markers.length > 0) {
    lines.push('', '## Did the changes help?', '');
    for (const m of report.markers) {
      const deltas = m.rates.map((r) => `${r.name} ${fmt(r.before)} -> ${fmt(r.after)}`).join(', ');
      lines.push(`- **${m.label}** (${m.beforeSessions} sessions before, ${m.afterSessions} after): ${deltas}`);
    }
  }
  if (report.hookErrors.length > 0) {
    lines.push('', '## Hook errors (guards failed open)', '');
    for (const e of report.hookErrors.slice(-5)) lines.push(`- ${new Date(e.ts).toISOString()} ${e.hook}: ${e.error}`);
  }
  return `${lines.join('\n')}\n`;
}

module.exports = { buildReport, renderMarkdown, addMarker };
