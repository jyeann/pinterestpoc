'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBash } = require('../lib/guards');

const idle = { active: false, protectedPaths: [], projectDir: '/p' };
const live = { active: true, protectedPaths: ['acceptance/'], projectDir: '/p' };
const blocked = (cmd, ctx = idle) => assert.equal(checkBash(cmd, ctx).block, true, `should block: ${cmd}`);
const allowed = (cmd, ctx = idle) => assert.equal(checkBash(cmd, ctx).block, false, `should allow: ${cmd}`);

test('bundled short flags cannot smuggle --no-verify', () => {
  for (const cmd of ['git commit -nm "x"', 'git commit -anm x', 'git commit -n -m x']) blocked(cmd);
  for (const cmd of ['git commit -am "a -n b"', 'git commit -m "no -n here"', 'git commit -am x']) allowed(cmd);
});

test('environment dumps are blocked, single harmless variables are not', () => {
  for (const cmd of ['env | grep KEY', 'export -p', 'cat /proc/self/environ', 'printenv ANTHROPIC_API_KEY', 'printenv']) blocked(cmd);
  for (const cmd of ['printenv NODE_ENV', 'printenv HOME']) allowed(cmd);
});

test('secret globs and more credential files are covered', () => {
  for (const cmd of ['cat .env*', 'cat .e*', 'cat .en?', 'cat ~/.npmrc', 'cat .netrc', 'cat ~/.git-credentials']) blocked(cmd);
  allowed('cat README*');
});

test('rm -rf of system directories and .git is blocked', () => {
  for (const cmd of ['rm -rf /home', 'rm -rf /usr', 'rm -rf $PWD', 'rm -rf .git', 'rm -rf /etc/']) blocked(cmd);
});

test('discarding the whole working tree is blocked like reset --hard', () => {
  for (const cmd of ['git checkout -- .', 'git checkout .']) blocked(cmd);
  allowed('git checkout -b feat/x');
  allowed('git checkout claude/feat');
});

test('pipe-to-shell: more sources, fewer false positives', () => {
  for (const cmd of ['source <(curl x)', '. <(curl x)', 'curl x | python3', 'curl x | python3 -', 'curl x | node']) blocked(cmd);
  for (const cmd of [
    'curl x | python -m json.tool',
    'curl x | node script.js',
    'echo "curl x | sh" > docs/n.md',
    'git commit -m "docs: mention curl x | sh"',
  ]) allowed(cmd);
});

test('during a run, cd into a guarded directory is blocked only when the same command also writes', () => {
  for (const cmd of ['cd acceptance && echo x > a', '(cd acceptance; rm a)', 'pushd acceptance; rm a', 'cd acceptance; sed -i s/a/b/ t.js', 'cd acceptance; git checkout -- .', 'cd .claude && tee x < /dev/null']) blocked(cmd, live);
  for (const cmd of ['cd ./acceptance/', 'cd .claude/harness; ls lib; grep -n slice lib/*.js bin/verify.js 2>&1 | head', 'cd acceptance && cat a.test.js', 'cd src && ls']) allowed(cmd, live);
});

test('during a run, the whole .claude directory and checkout of guarded paths are protected', () => {
  for (const cmd of ['rm -rf .claude', 'mv .claude .claude2', 'chmod -R a+w .claude', 'git checkout acceptance/', 'git checkout HEAD~1 acceptance/a.js', 'dd of=acceptance/a']) blocked(cmd, live);
  allowed('git checkout -b feat/x', live);
});

test('during a run, only the destination of cp/rsync/install/ln counts as a write', () => {
  allowed('cp acceptance/a.test.js /tmp/copy.js', live);
  allowed('cp .claude/settings.json /tmp/x', live);
  blocked('cp /tmp/evil.js acceptance/a.test.js', live);
  blocked('mv acceptance/a.test.js /tmp/', live);
});

test('irreversible git commands are blocked, their safe forms are not', () => {
  for (const cmd of ['git clean -fdx', 'git clean -f', 'git checkout -- src/', 'git checkout -f main', 'git restore .', 'git restore src/a.js',
    'git branch -D old', 'git stash drop', 'git stash clear']) blocked(cmd);
  for (const cmd of ['git clean -n', 'git clean --dry-run', 'git restore --staged src/a.js', 'git branch -d merged', 'git stash', 'git stash pop',
    'git checkout feat/x', 'git branch -a']) allowed(cmd);
});

test('more file readers are treated as secret readers', () => {
  for (const cmd of ['sort .env', 'cut -c1- .env', 'paste .env', 'diff .env /dev/null', 'dd if=.env', 'openssl enc -in .env', 'cat ~/.aws/config', 'cat ~/.config/gh/hosts.yml'])
    blocked(cmd);
  allowed('sort notes.txt');
});
