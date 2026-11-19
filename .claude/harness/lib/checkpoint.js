'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REF_PREFIX = 'refs/harness/wip/';
const GIT_TIMEOUT_MS = 60_000;
// Never snapshot harness state, env files or key material, even if they are not gitignored.
const EXCLUDES = [
  ':(exclude).harness',
  ':(exclude,glob)**/.env*',
  ':(exclude,glob)**/*.pem',
  ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/*.p12',
];
const IDENTITY = {
  GIT_AUTHOR_NAME: 'harness', GIT_AUTHOR_EMAIL: 'harness@localhost',
  GIT_COMMITTER_NAME: 'harness', GIT_COMMITTER_EMAIL: 'harness@localhost',
};

const git = (cwd, args, env = {}) => execFileSync('git', args, {
  cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
}).trim();

const tryGit = (cwd, args, env) => { try { return git(cwd, args, env); } catch { return null; } };

const checkpointRef = (branch) => `${REF_PREFIX}${branch.replace(/[^\w./-]+/g, '_')}`;
const currentBranch = (cwd) => tryGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']) || 'detached';

// Snapshots the whole worktree (tracked and untracked, honouring .gitignore) as a commit on a private ref,
// using a throwaway index. The branch, the real index and the worktree are never touched, so the commit gate
// keeps refusing commits while work-in-progress is still recoverable after a crash.
function writeCheckpoint(projectDir, { message = 'harness checkpoint', push = false } = {}) {
  const gitDir = tryGit(projectDir, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return { status: 'skipped', reason: 'not a git repository' };

  const ref = checkpointRef(currentBranch(projectDir));
  const indexFile = path.join(gitDir, `harness-wip-index.${process.pid}`);
  const env = { GIT_INDEX_FILE: indexFile, ...IDENTITY };
  try {
    const head = tryGit(projectDir, ['rev-parse', '-q', '--verify', 'HEAD']);
    if (head) git(projectDir, ['read-tree', 'HEAD'], env);
    git(projectDir, ['add', '-A', '--', '.', ...EXCLUDES], env);
    const tree = git(projectDir, ['write-tree'], env);

    const previous = tryGit(projectDir, ['rev-parse', '-q', '--verify', ref]);
    if (previous && tryGit(projectDir, ['rev-parse', `${previous}^{tree}`]) === tree) {
      return { status: 'unchanged', ref, commit: previous, pushed: false };
    }
    const parent = previous || head;
    const commit = git(projectDir, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], env);
    git(projectDir, ['update-ref', ref, commit]);
    return { status: 'created', ref, commit, pushed: push ? pushRef(projectDir, ref) : false };
  } catch (err) {
    return { status: 'error', reason: err.message.split('\n')[0] };
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

// Only the private wip ref is pushed (force: it is a scratch ref and may restart from scratch in a new sandbox).
function pushRef(projectDir, ref) {
  return tryGit(projectDir, ['push', '--quiet', 'origin', `+${ref}:${ref}`]) !== null;
}

// Restores the latest checkpoint's files over the worktree (does not delete files created after it).
function restoreCheckpoint(projectDir, { branch } = {}) {
  const ref = checkpointRef(branch || currentBranch(projectDir));
  let commit = tryGit(projectDir, ['rev-parse', '-q', '--verify', ref]);
  if (!commit && tryGit(projectDir, ['fetch', '--quiet', 'origin', `+${ref}:${ref}`]) !== null) {
    commit = tryGit(projectDir, ['rev-parse', '-q', '--verify', ref]);
  }
  if (!commit) return { status: 'none', ref };
  git(projectDir, ['restore', `--source=${commit}`, '--worktree', '--', '.']);
  return { status: 'restored', ref, commit };
}

module.exports = { writeCheckpoint, restoreCheckpoint, checkpointRef, REF_PREFIX };
