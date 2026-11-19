'use strict';
// Best-effort shell parser for guard decisions. It is NOT a full shell: it understands quotes,
// separators (&& || ; | & newline), subshells, $(...) / `...` / <(...), heredoc bodies, redirects,
// env-var prefixes, common wrappers and `git` global options. Anything cleverer (variable indirection,
// base64-decoded payloads, scripts written then executed) is out of scope; pair with isolation.
const path = require('node:path');

const MAX_DEPTH = 4;
const WRAPPERS = new Set(['command', 'env', 'exec', 'nice', 'nohup', 'time', 'sudo', 'builtin', 'stdbuf', 'timeout']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
const GIT_OPTS_FLAG = new Set(['--no-pager', '-P', '-p', '--bare', '--no-replace-objects', '--literal-pathspecs']);

function stripHeredocs(text) {
  const out = [];
  let terminator = null;
  for (const line of text.split('\n')) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    out.push(line);
    const m = line.match(/(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/);
    if (m) terminator = m[2];
  }
  return out.join('\n');
}

function nestedSubstitutions(text) {
  const found = [];
  for (const re of [/\$\(([^()]*)\)/g, /`([^`]*)`/g, /<\(([^()]*)\)/g]) {
    for (const m of text.matchAll(re)) found.push(m[1]);
  }
  return found;
}

// Split into raw simple commands, each a list of {text, quoted} tokens.
function scan(text) {
  const commands = [];
  let tokens = [];
  let cur = '';
  let quoted = false;
  let quote = null;
  let has = false;

  const endToken = () => {
    if (has) tokens.push({ text: cur, quoted });
    cur = ''; quoted = false; has = false;
  };
  const endCommand = () => {
    endToken();
    if (tokens.length > 0) commands.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[i + 1]; i += 1; }
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; quoted = true; has = true; continue; }
    if (ch === '\\' && i + 1 < text.length) { cur += text[i + 1]; has = true; i += 1; continue; }
    if (/\s/.test(ch) && ch !== '\n') { endToken(); continue; }
    const next = text[i + 1];
    // `>|` is a clobbering redirect, not a pipe: keep it inside the token so the target stays a redirect.
    if (ch === '|' && cur.endsWith('>')) { cur += ch; has = true; continue; }
    const redirectAmp = ch === '&' && (cur.endsWith('>') || cur.endsWith('<') || next === '>');
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '(' || ch === ')' || ch === '`' || (ch === '&' && !redirectAmp)) {
      endCommand();
      continue;
    }
    cur += ch; has = true;
  }
  endCommand();
  return commands;
}

const REDIRECT_OP = /^(\d*|&)>>?\|?$/;
const REDIRECT_ATTACHED = /^(?:\d*|&)>>?\|?([^&|].*)$/;
const FD_DUP = /^\d*[<>]&(\d+|-)$/;

function splitRedirects(tokens) {
  const argv = [];
  const redirects = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const { text, quoted } = tokens[i];
    if (!quoted && FD_DUP.test(text)) continue;
    if (!quoted && REDIRECT_OP.test(text)) {
      if (tokens[i + 1]) redirects.push(tokens[i + 1].text);
      i += 1;
      continue;
    }
    const attached = !quoted && text.match(REDIRECT_ATTACHED);
    if (attached) { redirects.push(attached[1]); continue; }
    if (text === '$' || text === '<') continue;
    argv.push(text);
  }
  return { argv, redirects };
}

function stripGitGlobals(argv) {
  const out = [argv[0]];
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (GIT_OPTS_WITH_VALUE.has(a)) i += 2;
    else if (GIT_OPTS_FLAG.has(a) || /^--(git-dir|work-tree|namespace|exec-path)=/.test(a)) i += 1;
    else break;
  }
  return out.concat(argv.slice(i));
}

function normalise(argvIn) {
  let argv = argvIn.slice();
  for (;;) {
    while (argv.length > 0 && /^[A-Za-z_]\w*=/.test(argv[0])) argv = argv.slice(1);
    // A bare wrapper (`env`, `sudo`) with nothing after it is itself the command (e.g. `env | grep KEY`).
    if (argv.length <= 1 || !WRAPPERS.has(path.basename(argv[0]))) break;
    const wrapper = path.basename(argv[0]);
    argv = argv.slice(1);
    while (argv.length > 0 && (argv[0].startsWith('-') || (wrapper === 'timeout' && /^\d/.test(argv[0])))) argv = argv.slice(1);
  }
  if (argv.length === 0) return argv;
  argv = [path.basename(argv[0]), ...argv.slice(1)];
  return argv[0] === 'git' ? stripGitGlobals(argv) : argv;
}

function parseCommands(text, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  const clean = stripHeredocs(text);
  const commands = nestedSubstitutions(clean).flatMap((inner) => parseCommands(inner, depth + 1));

  for (const tokens of scan(clean)) {
    const { argv: rawArgv, redirects } = splitRedirects(tokens);
    const argv = normalise(rawArgv);
    if (argv.length === 0 && redirects.length === 0) continue;
    commands.push({ argv, redirects });
    if (SHELLS.has(argv[0])) {
      const idx = argv.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
      if (idx > 0 && argv[idx + 1]) commands.push(...parseCommands(argv[idx + 1], depth + 1));
    }
    if (argv[0] === 'eval') commands.push(...parseCommands(argv.slice(1).join(' '), depth + 1));
  }
  return commands;
}

module.exports = { parseCommands, stripHeredocs };
