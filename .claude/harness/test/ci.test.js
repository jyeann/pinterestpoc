'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseProtectedList, changedProtected, DEFAULT_PROTECTED } = require('../lib/protected');
const { scanFiles, scanHistory, markerLines, markerContents } = require('../lib/secret-scan');

const HARNESS = path.join(__dirname, '..');
const REPO_ROOT = path.join(HARNESS, '..', '..');
const CHECK = path.join(HARNESS, 'bin', 'check-protected.js');
const SCAN = path.join(HARNESS, 'bin', 'scan-secrets.js');
const PROTECT = path.join(HARNESS, 'ci', 'protect.sh');
const RULESET = path.join(HARNESS, 'ci', 'ruleset.json');

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: cleanEnv, ...opts });
const git = (cwd, ...args) => {
  const r = run('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-'));
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}
function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

// ---------- protected-path matching ----------
test('parseProtectedList ignores comments and blanks', () => {
  assert.deepEqual(parseProtectedList('# note\n\nacceptance/\n  verify.config.json  \n'), ['acceptance/', 'verify.config.json']);
});

test('changedProtected matches directories, exact files and deletions, but not look-alikes', () => {
  const list = ['acceptance/', 'verify.config.json', '.claude/'];
  const hits = changedProtected(
    ['src/a.js', 'acceptance/t.js', 'acceptance-notes/x.md', 'verify.config.json', 'verify.config.json.bak', '.claude/harness/lib/a.js', './acceptance/u.js'],
    list,
  );
  assert.deepEqual(hits, ['acceptance/t.js', 'verify.config.json', '.claude/harness/lib/a.js', 'acceptance/u.js']);
});

test('DEFAULT_PROTECTED covers the gate itself', () => {
  for (const p of ['.claude/', '.github/', 'verify.config.json', 'acceptance/', '.harness-protected']) assert.ok(DEFAULT_PROTECTED.includes(p), p);
});

// ---------- check-protected CLI ----------
test('check-protected passes when only source changed and fails naming each protected file touched', () => {
  const dir = repo({ 'src/x.js': 'a', 'acceptance/a.test.js': 'a', 'verify.config.json': '{}' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  write(dir, { 'src/x.js': 'b' });
  git(dir, 'commit', '-qam', 'src only');
  assert.equal(run('node', [CHECK, '--base', 'main'], { cwd: dir }).status, 0);

  write(dir, { 'acceptance/a.test.js': 'weakened', 'verify.config.json': '{"minTests":0}' });
  git(dir, 'commit', '-qam', 'tamper');
  const r = run('node', [CHECK, '--base', 'main'], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /acceptance\/a\.test\.js/);
  assert.match(r.stdout, /verify\.config\.json/);
});

test('check-protected sees deletions and renames out of a protected path', () => {
  const dir = repo({ 'acceptance/a.test.js': 'a', 'src/x.js': 'x' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  git(dir, 'mv', 'acceptance/a.test.js', 'src/a.test.js');
  git(dir, 'commit', '-qm', 'move');
  const r = run('node', [CHECK, '--base', 'main'], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /acceptance\/a\.test\.js/);
});

test('check-protected adds the base .harness-protected paths to the defaults and rejects a bad base ref', () => {
  const dir = repo({ '.harness-protected': '# mine\nspecs/\n', 'specs/s.md': 's', 'acceptance/a.js': 'a', 'src/x.js': 'x' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  write(dir, { 'src/x.js': 'changed' });
  git(dir, 'commit', '-qam', 'src');
  assert.equal(run('node', [CHECK, '--base', 'main'], { cwd: dir }).status, 0);
  write(dir, { 'specs/s.md': 'changed' });
  git(dir, 'commit', '-qam', 'custom path');
  assert.equal(run('node', [CHECK, '--base', 'main'], { cwd: dir }).status, 1);
  const bad = run('node', [CHECK, '--base', 'no-such-ref'], { cwd: dir });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no-such-ref/);
});

test('a PR cannot shrink its own protection by editing .harness-protected', () => {
  const dir = repo({ '.harness-protected': 'specs/\n', 'acceptance/a.js': 'a', 'specs/s.md': 's' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  write(dir, { '.harness-protected': 'x\n', 'acceptance/a.js': 'weakened', 'specs/s.md': 'weakened' });
  git(dir, 'commit', '-qam', 'shrink list and tamper');
  const r = run('node', [CHECK, '--base', 'main'], { cwd: dir });
  assert.equal(r.status, 1);
  for (const f of ['.harness-protected', 'acceptance/a.js', 'specs/s.md']) assert.match(r.stdout, new RegExp(f.replace('.', '\\.')));
});

test('non-ASCII file names under protected paths are still caught', () => {
  const dir = repo({ 'acceptance/a.js': 'a', 'src/x.js': 'x' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  write(dir, { 'acceptance/caf\u00e9.test.js': 'always passes', 'acceptance/we ird\ttab.js': 'x' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'add');
  const r = run('node', [CHECK, '--base', 'main'], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /caf\u00e9\.test\.js/);
});

test('protected paths match case-insensitively (macOS/Windows checkouts)', () => {
  assert.deepEqual(changedProtected(['Acceptance/T.js', '.Claude/x', 'SRC/a.js'], ['acceptance/', '.claude/']), ['Acceptance/T.js', '.Claude/x']);
});

// ---------- secret scan ----------
const FAKE_KEY = `AK${'IA'}ABCDEFGHIJKLMNOP`;

test('scanFiles reports secrets with file:line and skips allow-marked lines and binaries', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  write(dir, {
    'a.js': `ok\nconst k = "${FAKE_KEY}";\n`,
    'b.js': `const k = "${FAKE_KEY}"; // harness:allow-secret\n`,
    'c.bin': Buffer.from([0, 1, 2, 0, 255]).toString('latin1'),
  });
  const found = scanFiles(dir, ['a.js', 'b.js', 'c.bin', 'missing.js']);
  assert.deepEqual(found.map((f) => `${f.file}:${f.line}`), ['a.js:2']);
});

test('scan-secrets CLI scans tracked files only and exits 1 on a finding', () => {
  const dir = repo({ 'ok.js': 'fine\n' });
  assert.equal(run('node', [SCAN], { cwd: dir }).status, 0);
  write(dir, { 'leak.js': `const k = "${FAKE_KEY}";\n` });
  assert.equal(run('node', [SCAN], { cwd: dir }).status, 0, 'untracked files are not scanned');
  git(dir, 'add', 'leak.js');
  const r = run('node', [SCAN], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /leak\.js:1/);
  assert.doesNotMatch(r.stdout, new RegExp(FAKE_KEY), 'the secret value itself is never printed');
});

// ---------- ruleset + apply script ----------
function fakeGh(responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegh-'));
  const log = path.join(dir, 'calls.log');
  const bin = path.join(dir, 'gh');
  fs.writeFileSync(bin, `#!/usr/bin/env bash\necho "$@" >> "${log}"\nif [[ "$*" == *"-X "* ]]; then cat > "${log}.body"; echo '{"id": 77}'; else cat <<'JSON'\n${responses}\nJSON\nfi\n`);
  fs.chmodSync(bin, 0o755);
  return { bin, log, body: `${log}.body` };
}

test('ruleset.json is valid, requires PRs and the CI job names that really exist, and forbids force pushes and deletion', () => {
  const rs = JSON.parse(fs.readFileSync(RULESET, 'utf8'));
  const types = rs.rules.map((r) => r.type);
  for (const t of ['pull_request', 'required_status_checks', 'non_fast_forward', 'deletion']) assert.ok(types.includes(t), t);
  const checks = rs.rules.find((r) => r.type === 'required_status_checks').parameters.required_status_checks.map((c) => c.context);
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const jobIds = [...ci.slice(ci.indexOf('\njobs:')).matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
  for (const c of checks) assert.ok(jobIds.includes(c), `required check "${c}" must be a job in ci.yml (found: ${jobIds})`);
});

test('protect.sh defaults to a dry run that prints the payload and never calls gh', () => {
  const gh = fakeGh('[]');
  const r = run('bash', [PROTECT, '--repo', 'o/r'], { env: { ...cleanEnv, GH: gh.bin } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.doesNotThrow(() => JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)));
  assert.equal(fs.existsSync(gh.log), false, 'gh must not be called without --apply');
});

test('protect.sh --apply creates the ruleset, with overridable checks and approvals', () => {
  const gh = fakeGh('[]');
  const r = run('bash', [PROTECT, '--repo', 'o/r', '--apply', '--checks', 'verify,protected-files', '--approvals', '1'], { env: { ...cleanEnv, GH: gh.bin } });
  assert.equal(r.status, 0, r.stderr);
  const calls = fs.readFileSync(gh.log, 'utf8');
  assert.match(calls, /-X POST repos\/o\/r\/rulesets/);
  const body = JSON.parse(fs.readFileSync(gh.body, 'utf8'));
  const rules = Object.fromEntries(body.rules.map((x) => [x.type, x.parameters]));
  assert.deepEqual(rules.required_status_checks.required_status_checks.map((c) => c.context), ['verify', 'protected-files']);
  assert.equal(rules.pull_request.required_approving_review_count, 1);
});

test('protect.sh keeps the admin bypass by default and --no-bypass removes it', () => {
  const withBypass = run('bash', [PROTECT, '--repo', 'o/r'], { env: cleanEnv });
  const strict = run('bash', [PROTECT, '--repo', 'o/r', '--no-bypass'], { env: cleanEnv });
  const parse = (out) => JSON.parse(out.stdout.slice(out.stdout.indexOf('{'), out.stdout.lastIndexOf('}') + 1));
  assert.equal(withBypass.status, 0, withBypass.stderr);
  assert.equal(strict.status, 0, strict.stderr);
  assert.equal(parse(withBypass).bypass_actors.length, 1);
  assert.deepEqual(parse(strict).bypass_actors, []);
  assert.equal(parse(strict).rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks.length, 5, 'the checks must be untouched');
});

test('protect.sh --apply --no-bypass sends an empty bypass list to GitHub', () => {
  const gh = fakeGh('[{"id": 42, "name": "protect-main"}]');
  const r = run('bash', [PROTECT, '--repo', 'o/r', '--apply', '--no-bypass'], { env: { ...cleanEnv, GH: gh.bin } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(gh.log, 'utf8'), /-X PUT repos\/o\/r\/rulesets\/42/);
  assert.deepEqual(JSON.parse(fs.readFileSync(gh.body, 'utf8')).bypass_actors, []);
});

test('protect.sh --apply updates an existing ruleset of the same name instead of duplicating it', () => {
  const gh = fakeGh('[{"id": 42, "name": "protect-main"}, {"id": 5, "name": "other"}]');
  const r = run('bash', [PROTECT, '--repo', 'o/r', '--apply'], { env: { ...cleanEnv, GH: gh.bin } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(gh.log, 'utf8'), /-X PUT repos\/o\/r\/rulesets\/42/);
});

test('protect.sh rejects a malformed repo and a non-numeric approvals value', () => {
  assert.notEqual(run('bash', [PROTECT, '--repo', 'not-a-repo'], { env: cleanEnv }).status, 0);
  assert.notEqual(run('bash', [PROTECT, '--repo', 'o/r', '--approvals', 'many'], { env: cleanEnv }).status, 0);
});

test('workflows are valid, pinned to SHAs, least-privilege, and never interpolate untrusted context into shell', () => {
  const files = [path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), path.join(HARNESS, 'ci', 'verify.yml')];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${path.basename(file)}: ${m[1]} must be pinned to a commit SHA`);
    assert.match(text, /^permissions:\n {2}contents: read$/m, `${path.basename(file)} must default to read-only permissions`);
    assert.doesNotMatch(text, /pull_request_target/, 'pull_request_target runs untrusted code with secrets');
    for (const m of text.matchAll(/^\s+run:\s*(.*)$/gm)) assert.doesNotMatch(m[1], /\$\{\{/, `${path.basename(file)}: expression inside run: ${m[1]}`);
  }
  const jobs = [...fs.readFileSync(path.join(HARNESS, 'ci', 'verify.yml'), 'utf8').matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
  for (const j of ['verify', 'protected-files', 'secret-scan']) assert.ok(jobs.includes(j), `template job ${j}`);
});

test('scanFiles reads through NUL bytes (UTF-16 style) instead of skipping the whole file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-nul-'));
  fs.writeFileSync(path.join(dir, 'w.txt'), Buffer.from(`k="${FAKE_KEY}"`, 'utf16le'));
  assert.deepEqual(scanFiles(dir, ['w.txt']).map((f) => f.file), ['w.txt']);
});

test('scanHistory finds secrets that were added and later removed, naming commit and file but not the value', () => {
  const log = [
    'commit 1234567890abcdef', 'Author: t', '', '    add', '',
    'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -0,0 +1 @@', `+const k = "${FAKE_KEY}";`,
    'commit fedcba0987654321', '', 'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -1 +0,0 @@', `-const k = "${FAKE_KEY}";`,
  ].join('\n');
  const found = scanHistory(log);
  assert.deepEqual(found.map((f) => `${f.commit} ${f.file}`), ['1234567 src/a.js']);
});

test('scan-secrets --history catches a secret removed before the PR head; plain scan does not', () => {
  const dir = repo({ 'src/a.js': 'ok\n' });
  git(dir, 'checkout', '-q', '-b', 'feat');
  write(dir, { 'src/a.js': `const k = "${FAKE_KEY}";\n` });
  git(dir, 'commit', '-qam', 'oops');
  write(dir, { 'src/a.js': 'ok\n' });
  git(dir, 'commit', '-qam', 'remove it');
  assert.equal(run('node', [SCAN], { cwd: dir }).status, 0);
  const r = run('node', [SCAN, '--history', 'main'], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /history/i);
  assert.doesNotMatch(r.stdout, new RegExp(FAKE_KEY));
});

test('allow-secret markers are listed so a reviewer sees every exemption', () => {
  const dir = repo({ 'a.js': `const k = "${FAKE_KEY}"; // harness:allow-secret\nplain\n` });
  assert.deepEqual(markerLines(dir, ['a.js']), ['a.js:1']);
  const r = run('node', [SCAN], { cwd: dir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /a\.js:1/);
});

test('protect.sh pins required checks to the GitHub Actions app, paginates, and rejects dot segments', () => {
  const dry = run('bash', [PROTECT, '--repo', 'o/r', '--checks', 'verify'], { env: cleanEnv });
  const payload = JSON.parse(dry.stdout.slice(dry.stdout.indexOf('{'), dry.stdout.lastIndexOf('}') + 1));
  const checks = payload.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks;
  assert.deepEqual(checks, [{ context: 'verify', integration_id: 15368 }]);
  for (const c of JSON.parse(fs.readFileSync(RULESET, 'utf8')).rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks) {
    assert.equal(c.integration_id, 15368);
  }
  const gh = fakeGh('[]');
  run('bash', [PROTECT, '--repo', 'o/r', '--apply'], { env: { ...cleanEnv, GH: gh.bin } });
  assert.match(fs.readFileSync(gh.log, 'utf8'), /--paginate/);
  assert.notEqual(run('bash', [PROTECT, '--repo', '../x'], { env: cleanEnv }).status, 0);
  assert.notEqual(run('bash', [PROTECT, '--repo', 'o/..'], { env: cleanEnv }).status, 0);
});

test('the project template has no label bypass, runs the checker from the base tree, and scans history', () => {
  const t = fs.readFileSync(path.join(HARNESS, 'ci', 'verify.yml'), 'utf8');
  assert.doesNotMatch(t, /harness-protected-change|labeled/);
  assert.match(t, /git worktree add/);
  assert.match(t, /check-protected\.js/);
  assert.match(t, /--history/);
  for (const file of [path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), path.join(HARNESS, 'ci', 'verify.yml')]) {
    assert.match(fs.readFileSync(file, 'utf8'), /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  }
});

test('a history finding is excused once the same line carries a deliberate marker in the tree, and stays visible', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-allow-'));
  const line = `const k = "${FAKE_KEY}";`;
  write(dir, { 'a.js': `${line}  // harness:allow-secret (deliberate fixture)\n` });
  const allowed = markerContents(dir, ['a.js']);
  const log = ['commit abcdef1234567', '+++ b/a.js', `+${line}`].join('\n');
  assert.deepEqual(scanHistory(log, allowed), []);
  assert.equal(scanHistory(log).length, 1, 'without the marker it is still reported');
  assert.equal(scanHistory(log.replace('k =', 'other ='), allowed).length, 1, 'a different line is not excused');
});
