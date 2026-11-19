'use strict';
// Server-side twin of the in-session read-only guard: which changed files must a PR not touch?
const DEFAULT_PROTECTED = ['.claude/', '.github/', '.harness-protected', 'verify.config.json', 'acceptance/', 'spec.md'];

const normalise = (file) => file.replace(/^\.\//, '');

function parseProtectedList(text) {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

// Directory entries end with "/" and match by prefix; everything else must match exactly (no look-alikes).
// Matching is case-insensitive: a checkout on macOS/Windows treats `Acceptance/` and `acceptance/` as one path.
function changedProtected(files, list) {
  const lower = list.map((e) => e.toLowerCase());
  return files.map(normalise).filter((f) => {
    const l = f.toLowerCase();
    return lower.some((entry) => (entry.endsWith('/') ? l.startsWith(entry) : l === entry));
  });
}

module.exports = { DEFAULT_PROTECTED, parseProtectedList, changedProtected };
