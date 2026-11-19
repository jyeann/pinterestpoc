# Loop Runbook

Pattern: sequential | Mode: safe

## Goal
Work through every AFK task in `TASKS.md` until all are done and the test suite is green.
`TASKS.md` format: `.claude/harness/templates/tasks.md` (build it with the `plan-to-tasks` skill).

## Run it under the harness (enforced limits)
Prose limits depend on the agent obeying them. Start the run with the harness so they are enforced:
```bash
node .claude/harness/bin/harness.js init --verify "<cmd>" --task-file TASKS.md \
  --max 10 --stall 3 --max-minutes 60 --no-progress 3 [--checkpoint-push]
```
| Stop condition | Enforced by |
|---|---|
| 10 total iterations | `--max 10` |
| Same stack trace 3 times | `--stall 3` |
| 1 hour wall-clock | `--max-minutes 60` |
| No progress (failing-test count not dropping) | `--no-progress 3` |
| 3 consecutive BLOCKED tasks | agent, on its honour (log it) |
| Merge conflict, or a change touching secrets/auth/payments | secret scan + guards; the agent stops and asks a human |

Every halt gets one bounded diagnosis turn (`HARNESS-DIAGNOSIS.md`) before the run ends.

## Branch rules (agent does automatically)
1. Create branch `loop/<goal-slug>-<YYYYMMDD>` from the default branch. Never work on the default branch.
2. Push only this branch.
3. Commits: with the harness commit gate on (the default), do not commit per task. Work-in-progress is checkpointed
   automatically to `refs/harness/wip/<branch>`; commit once when verify is green. For one commit per task, start with
   `--no-commit-gate`. Use conventional commits either way.

## Before iteration 1
- Run `node .claude/harness/bin/harness.js verify`. If it fails for a reason other than the unfinished tasks, STOP and report.
- Record the baseline in `.claude/plans/loop-log.md`: failing tests, coverage.

## Each iteration
1. Run `node .claude/harness/bin/next-task.js TASKS.md`. Exit 0 lists the ready tasks (AFK, unblocked): take the first and
   set it `doing`. Exit 3 means stop: `ALL_DONE` = success, `NEEDS_HUMAN` or `STUCK` = escalate, `IN_PROGRESS` = a task was left `doing` by an interrupted iteration: resume it. Exit 2 = fix the file format.
2. Write/adjust a failing test, implement, run tests.
3. If tests pass and no new lint/type errors: set the task `done`, log a checkpoint line in `.claude/plans/loop-log.md` (and commit both together, if the commit gate is off).
4. If tests fail: go to "On failure".

## On failure (check and repeat until cause is clear)
1. Reproduce and read the full error/logs.
2. State a root-cause hypothesis in the log.
3. Make the smallest fix, re-run tests.
4. Max 3 attempts per issue. Do not repeat an identical fix.
5. After 3 attempts with the cause still unclear: mark the task BLOCKED, write what was learned, move to next task.

## Finish (agent does)
1. Run full tests + lint + type check; confirm coverage >= 80%.
2. Push the branch and write a summary in `.claude/plans/loop-log.md` (done, blocked, how to roll back).
3. Open a PR to the default branch. DO NOT merge. A human reviews and merges.

## Rollback
`git revert` the loop's commits, or delete the branch. Default branch is never touched. After a crash, `harness.js restore`.
