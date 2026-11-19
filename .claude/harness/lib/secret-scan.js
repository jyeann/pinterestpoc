'use strict';
// Repo-wide secret scan for CI, reusing the same patterns as the write guard. Never returns the secret itself.
const fs = require('node:fs');
const path = require('node:path');
const { scanSecrets } = require('./guards');

const MAX_BYTES = 10_000_000;
const ALLOW_MARKER = 'harness:allow-secret';

function scanFiles(root, files) {
  const found = [];
  for (const file of files) {
    const abs = path.join(root, file);
    let buf;
    try {
      if (!fs.statSync(abs).isFile() || fs.statSync(abs).size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch { continue; }
    // NULs are removed, not a reason to skip: a UTF-16 file or one stray NUL must not hide a secret.
    buf.toString('utf8').replace(/\0/g, '').split('\n').forEach((line, i) => {
      const kinds = scanSecrets(line);
      if (kinds.length > 0) found.push({ file, line: i + 1, kinds });
    });
  }
  return found;
}

// `git log -p` text: report commit and file for secrets on added lines, so one added then removed is still found.
// A historical line is excused when the same line now exists in the tree carrying an allow-secret marker.
const normaliseLine = (line) => line.split(ALLOW_MARKER)[0].replace(/\s*(?:\/\/|#|<!--)?\s*$/, '').trim();

function scanHistory(logText, allowed = new Set()) {
  const found = [];
  const seen = new Set();
  let commit = '';
  let file = '';
  for (const line of logText.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 14);
    else if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+')) {
      const kinds = allowed.has(normaliseLine(line.slice(1))) ? [] : scanSecrets(line.slice(1));
      const key = `${commit} ${file}`;
      if (kinds.length > 0 && !seen.has(key)) { seen.add(key); found.push({ commit, file, kinds }); }
    }
  }
  return found;
}

// Every line that opts out of the scan, so a reviewer can see each exemption.
function markerLines(root, files) {
  const out = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => { if (line.includes(ALLOW_MARKER)) out.push(`${file}:${i + 1}`); });
  }
  return out;
}

function markerContents(root, files) {
  const out = new Set();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) if (line.includes(ALLOW_MARKER)) out.add(normaliseLine(line));
  }
  return out;
}

module.exports = { scanFiles, scanHistory, markerLines, markerContents };
