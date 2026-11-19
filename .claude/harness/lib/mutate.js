'use strict';
// Tiny deterministic mutation sampler. Each mutant flips ONE operator; the test suite should fail on it.
// A surviving mutant points at behaviour the tests do not pin down.
const crypto = require('node:crypto');
const vm = require('node:vm');

const RULES = [
  [/(?<!!)===/g, '!=='],
  [/!==/g, '==='],
  [/&&/g, '||'],
  [/\|\|/g, '&&'],
  [/(?<![>=<])>=(?!=)/g, '>'],
  [/(?<![<=>])<=(?!=)/g, '<'],
  [/\btrue\b/g, 'false'],
  [/\bfalse\b/g, 'true'],
];

// Characters after which a `/` starts a regex literal rather than a division.
const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^}'.split(''));
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|case|delete|void|throw|new|else|do|yield|await)$/;
const regexAllowed = (prev, before) => prev === '' || REGEX_PRECEDERS.has(prev) || REGEX_KEYWORDS.test(before.trimEnd());

// Blank out comments, string/template text and regex literals (same length, newlines kept) so operators
// inside them are never mutated. Code inside template `${...}` stays visible.
function maskNonCode(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' '; };
  const stack = []; // 'tpl' (inside template text) | 'brace' (inside ${...} or a nested block)
  let prev = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (stack[stack.length - 1] === 'tpl') {
      if (ch === '\\') { blank(i, i + 2); i += 2; }
      else if (ch === '`') { stack.pop(); prev = '`'; i += 1; }
      else if (ch === '$' && src[i + 1] === '{') { stack.push('brace'); prev = '{'; i += 2; }
      else { blank(i, i + 1); i += 1; }
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop); i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop); i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j); i = j + 1; prev = ch;
    } else if (ch === '`') {
      stack.push('tpl'); i += 1;
    } else if (ch === '/' && regexAllowed(prev, src.slice(0, i))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') j += 1;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j += 1;
      }
      if (src[j] === '/') { blank(i, j + 1); i = j + 1; prev = 'x'; } else { prev = ch; i += 1; }
    } else {
      if (ch === '{' && stack.length > 0) stack.push('brace');
      else if (ch === '}' && stack[stack.length - 1] === 'brace') stack.pop();
      if (!/\s/.test(ch)) prev = ch;
      i += 1;
    }
  }
  return out.join('');
}

const isModuleSyntax = (src) => /^\s*(import|export)\s/m.test(src);
const compiles = (src) => {
  try { new vm.Script(`(function(){${src.replace(/^#!.*/, '//')}\n})`); return true; } catch { return false; }
};

function applyMutation(source, { index, from, to }) {
  return source.slice(0, index) + to + source.slice(index + from.length);
}

function listMutations(source) {
  const masked = maskNonCode(source);
  const found = [];
  for (const [re, to] of RULES) {
    for (const m of masked.matchAll(re)) {
      found.push({ index: m.index, from: m[0], to, line: source.slice(0, m.index).split('\n').length });
    }
  }
  found.sort((a, b) => a.index - b.index);
  return isModuleSyntax(source) ? found : found.filter((m) => compiles(applyMutation(source, m)));
}

function seededRandom(seed) {
  let a = crypto.createHash('sha1').update(String(seed)).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pick up to k mutants, round-robin across files so one big file cannot dominate. Same seed -> same picks.
function selectMutations(pool, k, seed) {
  if (pool.length <= k) return pool.slice();
  const rand = seededRandom(seed);
  const groups = new Map();
  for (const m of pool) groups.set(m.file, [...(groups.get(m.file) ?? []), m]);
  const queues = [...groups.keys()].sort().map((file) => {
    const items = groups.get(file).slice();
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  });
  const picked = [];
  while (picked.length < k && queues.some((q) => q.length > 0)) {
    for (const q of queues) if (picked.length < k && q.length > 0) picked.push(q.shift());
  }
  return picked;
}

module.exports = { listMutations, applyMutation, selectMutations, maskNonCode };
