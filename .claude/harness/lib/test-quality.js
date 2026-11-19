'use strict';

const ASSERTION = /\bassert(?:\.\w+)?\s*\(|\bexpect\s*\(/g;
const LITERAL = String.raw`(true|\d+|'[^']*'|"[^"]*")`;
const TAUTOLOGY = new RegExp(String.raw`\bassert(?:\.\w+)?\(\s*${LITERAL}\s*(?:,\s*${LITERAL}\s*)?[,)]`, 'g');
const EXPECT_TAUTOLOGY = /\bexpect\(\s*(true|\d+)\s*\)\.\w+\(\s*(?:\1)?\s*\)/;
const SKIPPED = /\b(?:test|it|describe)\.(?:skip|todo)\b|\bx(?:it|describe)\(|\{\s*(?:skip|todo)\s*:\s*true/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasTautology(text) {
  for (const m of text.matchAll(TAUTOLOGY)) {
    if (m[1] === 'true' && m[2] === undefined) return true;
    if (m[2] !== undefined && m[1] === m[2]) return true;
  }
  return EXPECT_TAUTOLOGY.test(text);
}

function referencesSrc(text, srcDirs) {
  return srcDirs.some((dir) => {
    const d = escapeRe(dir);
    return new RegExp(String.raw`(?:^|[^\w])${d}[/\\'"\`]|['"\`]${d}['"\`]`).test(text);
  });
}

// Static checks that catch placeholder tests: they must touch the source, assert something real, and not be skipped.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function analyzeTestFile(rawText, { srcDirs = ['src'], minAssertions = 3 } = {}) {
  const text = stripComments(rawText);
  const assertions = (text.match(ASSERTION) ?? []).length;
  const issues = [];
  if (hasTautology(text)) issues.push('contains a tautological assertion (e.g. assert.ok(true), assert.equal(1, 1))');
  if (SKIPPED.test(text)) issues.push('contains skipped or todo tests');
  if (!referencesSrc(text, srcDirs)) issues.push(`never references the source (${srcDirs.join(', ')}); it cannot test it`);
  if (assertions < minAssertions) issues.push(`only ${assertions} assertion(s); at least ${minAssertions} required`);
  return { assertions, issues };
}

module.exports = { analyzeTestFile };
