# CI and branch protection

The in-session hooks make a good-faith agent behave. This directory is the server-side backstop that holds
even if a hook is bypassed or an agent is misguided: nothing reaches the default branch except through a pull
request whose checks pass, and the checks themselves cannot be quietly weakened.

| File | Purpose |
|---|---|
| `/.github/workflows/ci.yml` | CI for **this** repo: `harness-tests` (all tests, 90% coverage floor) and `secret-scan` (tree + PR history). |
| `verify.yml` | Template for a project **built with** the harness: `verify` (strong verify), `protected-files`, `secret-scan`. Copy to `.github/workflows/`. |
| `ruleset.json` | Branch ruleset for the default branch: PR required, required checks pinned to the Actions app, no force-push, no deletion. |
| `protect.sh` | Creates or updates that ruleset with `gh`. Dry run unless `--apply`. |
| `CODEOWNERS.example` | For teams: code-owner review of the gate paths. |
| `../bin/check-protected.js` | Fails a PR that touches `.claude/`, `.github/`, `acceptance/`, `verify.config.json`, `spec.md` or `.harness-protected`. Extra paths come from `.harness-protected` **on the base branch** (a PR cannot shrink its own list), unioned with the defaults; matching is case-insensitive and safe for non-ASCII names. |
| `../bin/scan-secrets.js` | Scans git-tracked files, and with `--history <base>` every line a PR added (a secret added then removed is still leaked). Prints `file:line`, never the secret, and lists every `harness:allow-secret` exemption for the reviewer. |

## Turn it on (order matters)
1. Merge or push the workflow so each check runs at least once. A required check that never reports blocks every merge.
2. Preview: `bash .claude/harness/ci/protect.sh --repo OWNER/NAME`
3. Apply: `bash .claude/harness/ci/protect.sh --repo OWNER/NAME --apply` (needs `gh auth login` with admin rights). Add `--no-bypass` if an agent works with an admin token (see Limits).
   For a harness-built project: `--checks verify,protected-files,secret-scan`. For a team: `--approvals 1` plus `CODEOWNERS.example`.

Defaults suit a solo owner: a PR and green checks are required, but zero approvals, because GitHub does not let
an author approve their own PR. **Repository admins can bypass through a PR; that is the human override** for a
deliberate change to the gate (there is no label override: anyone with triage rights could add one). Rulesets need
a public repo, or a Pro/Team plan on a private one.

## Limits (read these)
- **If the agent's token is an admin's, use `--no-bypass`.** The default ruleset lets repository admins merge past the required checks through a PR; a session signed in as the owner then is not held to the checks (a PR with checks still running showed `unstable`, not `blocked`). `--no-bypass` empties the bypass list so nobody can skip them; the human override becomes switching the ruleset off in Settings.
- **Do not give the agent an admin token.** An admin can bypass the ruleset, and any token that can edit rulesets
  or settings can remove it. Give the agent a fine-grained token: contents + pull requests write on one repo, nothing else.
- **Workflow files come from the PR.** `pull_request` runs the PR's own `.github/workflows/*.yml`, so a PR could replace
  a job with one that always passes under the same name. `protected-files` flags any change under `.github/` (and runs
  the checker from the base branch), but it is itself one of those jobs. Read the diff of `.github/` and `.claude/`
  before merging; for teams, require code-owner review of them.
- **Bootstrap:** the first PR that adds the harness has no base copy of the checker; merge it as an admin.
- **Not tested against live GitHub.** The script is tested with a fake `gh` (payload, create vs update, overrides) and the
  workflows are validated structurally and by running their commands locally. The first real `--apply` and the first PR are
  the live test; check Settings > Rules afterwards. `integration_id` 15368 is the GitHub Actions app.
- **Secret scan is pattern-based:** it will not see base64, split strings, or values containing words like "example".
- Actions are pinned to commit SHAs (the comment shows the tag, resolved with `git ls-remote`). Refresh them deliberately.
