'use strict';
// Source-file line coverage from raw V8 coverage (NODE_V8_COVERAGE). Unlike the test runner's built-in
// report, it counts child processes (e.g. a server spawned by an acceptance test) and only the files you ask for.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const isCommentOrBlank = (line) => {
  const t = line.trim();
  return t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
};

function coveredChars(length, processes) {
  const covered = new Uint8Array(length);
  for (const functions of processes) {
    const counts = new Int32Array(length);
    // Outer ranges first, nested ones after, so a nested count overrides its parent.
    const ranges = functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
    for (const { startOffset, endOffset, count } of ranges) counts.fill(count, startOffset, Math.min(endOffset, length));
    for (let i = 0; i < length; i += 1) if (counts[i] > 0) covered[i] = 1;
  }
  return covered;
}

// processes: one `functions` array per process that loaded the file. Returns line-level coverage.
function lineCoverage(rawSource, processes) {
  const source = rawSource.replace(/^\uFEFF/, ''); // Node strips the BOM before compiling, so V8 offsets exclude it
  const covered = coveredChars(source.length, processes);
  let executable = 0;
  let hit = 0;
  const uncoveredLines = [];
  let offset = 0;
  source.split('\n').forEach((line, i) => {
    if (!isCommentOrBlank(line)) {
      executable += 1;
      let lineHit = false;
      for (let j = 0; j < line.length && !lineHit; j += 1) lineHit = !/\s/.test(line[j]) && covered[offset + j] === 1;
      if (lineHit) hit += 1; else uncoveredLines.push(i + 1);
    }
    offset += line.length + 1;
  });
  const pct = executable === 0 ? 100 : Math.round((hit / executable) * 10000) / 100;
  return { executable, covered: hit, uncoveredLines, pct };
}

// Map of project-relative path -> list of per-process function arrays.
function collectCoverage(dir, projectRoot) {
  const roots = new Set([projectRoot, fs.realpathSync(projectRoot)]);
  const byFile = new Map();
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch { continue; }
    for (const entry of parsed.result ?? []) {
      if (!entry.url?.startsWith('file:')) continue;
      const abs = fileURLToPath(entry.url);
      const root = [...roots].find((r) => abs.startsWith(`${r}${path.sep}`));
      if (!root) continue;
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (rel.split('/').includes('node_modules')) continue;
      byFile.set(rel, [...(byFile.get(rel) ?? []), entry.functions ?? []]);
    }
  }
  return byFile;
}

module.exports = { lineCoverage, collectCoverage };
