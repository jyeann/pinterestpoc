---
description: Run an unattended build to completion against a spec, with an objective verify gate, iteration cap and stall breaker.
---

Parse from $ARGUMENTS:
1. `spec` - path to the spec file (see `.claude/harness/templates/spec.md`)
2. `--verify "<cmd>"` - command that exits 0 only when the work is done (required). For Node projects prefer `node .claude/harness/bin/verify.js` with a `verify.config.json` (tests, source coverage, test quality, mutation spot-check); protect the config with `--protect`
3. `--max N` - iteration cap (default 20)
4. `--stall N` - identical-failure repeats before halting (default 3)
5. `--protect a/,b/` - extra read-only paths, e.g. the acceptance tests
6. `--no-commit-gate` - allow checkpoint commits while verify is failing (default: commits are refused until verify is green)
7. `--hide <paths>` - hidden holdout acceptance tests (keep them outside the project; agent cannot read them; wire them into `verify.config.json` as `holdout`)
8. `--no-diagnosis` - skip the one-turn failure diagnosis when the run is stuck
9. `--max-minutes N` / `--no-progress N` - wall-clock budget and a halt when the failing-test count stops dropping for N iterations
10. `--require-sandbox` - refuse to start when the sandbox is enabled in settings but cannot run
11. `--no-checkpoint` / `--checkpoint-push` - WIP snapshots to `refs/harness/wip/<branch>` run on every Stop attempt by default (no branch commits); `--checkpoint-push` also pushes that ref to origin so a lost sandbox is recoverable (`harness.js restore`)

Tip: to pick a model and effort for a spec, run `node .claude/harness/bin/tune.js` first (see harness README).

## Preconditions (stop and tell the human if any fails)
- You are on a feature branch, not main/master.
- Acceptance tests already exist and fail for the right reason (RED). Run the verify command once and confirm it fails.
- The workspace is trusted (otherwise the allow list is ignored and you cannot run verify) and, for real runs, `bwrap` and `socat` are installed so the sandbox is active. `init` prints a warning for each; pass `--require-sandbox` to make a missing sandbox fatal.
- The spec lists exact interfaces; if it does not, send it back to `planner` first.

## Start the run
```bash
node .claude/harness/bin/harness.js init --verify "<cmd>" --task-file <spec> --protect <paths> --max N --stall N [--no-commit-gate] [--checkpoint-push]
```
From this point the Stop hook re-runs the verify command every time you try to finish and sends you back to work
until it passes, the cap is hit, or the same failure repeats `--stall` times. By default commits are refused while verify fails, so keep work-in-progress in the working tree and commit when green (or start with `--no-commit-gate` if you want checkpoint commits).

## Work loop (delegate; you only orchestrate)
1. `tdd-guide` or `gan-generator`: implement against the spec and acceptance tests. Unit tests first.
2. `code-reviewer` (and `security-reviewer` for auth, input, files, network): review the diff. Fix CRITICAL and HIGH.
3. `gan-evaluator` in `code-only` mode, or `agent-evaluator`: an independent skeptic grades the result against the spec.
4. Commit on the feature branch when verify is green. Never push to main; never edit the verify command, acceptance tests or harness files.

## Finish
When verify passes the loop releases you. Then: `node .claude/harness/bin/harness.js status`, write a short report
(what was built, verify output, anything the evaluator flagged, what a human must review), and stop. A human reviews the
diff before any merge or deploy.

If the run halts (`halted-stalled` or `halted-max-iterations`), do not retry silently. The harness gives you one diagnosis turn first: do not fix anything, write `HARNESS-DIAGNOSIS.md` classifying each failure group as IMPL_BUG, TEST_AMBIGUOUS, TEST_WRONG or ENV, then report the last failure and what you tried.
