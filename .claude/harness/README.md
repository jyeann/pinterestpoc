# Harness: unattended build loop

A small, dependency-free guardrail layer for running agents to completion without a human in the loop.
The agent decides *how*; the harness decides *when it is done* and *what it may never do*.

| Piece | File | What it enforces |
|---|---|---|
| Definition of done | `hooks/stop.js` + `lib/stop-loop.js` | Agent cannot stop until the verify command exits 0. Re-runs it on every stop attempt and feeds failures back. |
| Iteration cap | `lib/stop-loop.js` | Halts after `--max` iterations. |
| Circuit breaker | `lib/stop-loop.js` | Halts when the same failure (numbers stripped) repeats `--stall` times. |
| Time budget | `lib/stop-loop.js` | `--max-minutes N` halts (`halted-time`) once the run is older than N minutes, checked on each failing Stop attempt. |
| No-progress breaker | `lib/stop-loop.js` | `--no-progress N` halts (`halted-no-progress`) when the number of failing tests has not dropped below its best for N failing iterations. Skipped when failures cannot be counted (non-`node:test` output). |
| Model x effort search | `bin/tune.js` + `lib/tune.js` | Runs the same task per `model:effort` candidate in a throwaway git worktree, grades with the verify command, reports the cheapest that passes (see below). |
| Commit gate | `hooks/pre-bash.js` | `git commit` is refused while verify fails (`--no-commit-gate` allows checkpoint commits). |
| WIP checkpoint | `lib/checkpoint.js` + `hooks/stop.js` | Every Stop attempt snapshots the worktree to `refs/harness/wip/<branch>` via a throwaway index: the branch, index and worktree are untouched, so the commit gate still holds. Skips `.harness/`, `.env*`, `*.pem`, `*.key`, `*.p12`. `--no-checkpoint` disables it; `--checkpoint-push` also pushes that one ref to `origin` so it survives losing the sandbox. |
| Stuck diagnosis | `lib/failure-cluster.js` + `hooks/stop.js` | At the iteration cap or a stall the agent gets ONE bounded turn (no fixing) to classify the remaining failures, grouped by error, as `IMPL_BUG`, `TEST_AMBIGUOUS`, `TEST_WRONG` or `ENV` in `HARNESS-DIAGNOSIS.md`, then the run halts. A stuck loop is usually a broken eval. `--no-diagnosis` halts immediately. |
| Hidden holdout | `lib/strong-verify.js` + `hooks/pre-read.js` | Acceptance tests the agent never sees (see below). |
| Strong verify | `bin/verify.js` + `lib/strong-verify.js` | A stricter done-gate than "tests exit 0" (see below). Use it as the `--verify` command. |
| CI + branch protection | `ci/` (`README.md`) | Server-side backstop: required PR + checks, protected-files check, secret scan, ruleset script. |
| Dangerous commands | `lib/guards.js` | Force/mirror push, push to main/master (including a bare `git push` while on main), `rm -rf /`, `curl \| sh`, `--no-verify`, `reset --hard`, reading/staging `.env`/keys. `lib/shell.js` understands quotes, env prefixes, wrappers, `git -C`, subshells, `$(...)`, `bash -c` and heredocs. |
| Secret scan | `hooks/pre-write.js` | Blocks writes containing high-confidence secrets. |
| Self-protection | `lib/guards.js` | While a run is active, settings, harness files, `.harness/` and `--protect` paths are read-only, and the agent cannot run `harness off/init`. |

| Session trace | `hooks/post-tool.js` + `lib/trace.js` | Records every tool call (ok or failed), guard block and stop to `.harness/traces/<session>.jsonl`. Redacted, truncated summaries only; never blocks. |
| Scorers | `lib/score.js` | `efficiency` (failed or repeated tool calls), `verified-before-done` (a passing check after the last code edit), `guardrail-attempts`. |
| Report + markers | `bin/report.js` + `lib/report.js` | Pass rates, last-10 vs previous-10 trend, most common failures, and before/after rates around changes you `--mark`. |
| Improver | `agents/harness-improver.md`, `/harness-improve` | Read-only agent proposes ONE change from the evidence; a human merges it. |

| Reference check | `bin/check-refs.js` + `lib/refs.js` | Fails on commands, agents, skills or rules that point at a script, skill, rules dir, agent or removed command that does not exist. Runs in CI via the test suite, so an upstream sync that re-adds a broken item is caught. |

Everything except the secret scan, the dangerous-command blocklist and tracing is inert unless `.harness/state.json` says a run is active.

## Learning loop (record, score, propose, measure)
```bash
node .claude/harness/bin/report.js            # what keeps going wrong
/harness-improve                              # read-only agent proposes one fix, you review and merge
node .claude/harness/bin/report.js --mark "merged port-discovery skill"   # later reports show before/after
```
Traces live in `.harness/` (gitignored, local to the machine). In an ephemeral cloud container they vanish with it:
copy `.harness/traces/` somewhere durable (artifact store, bucket) before the container is reclaimed, or run the report in the same session.
The scorers are deterministic and cheap. Subjective rubrics (verbosity, redundant tests) need an LLM judge reading the same traces; not built yet.
The improver is untrusted-input aware: traces are data, and it may not propose widening permissions or touching hooks, deny rules, harness code or CI.

## Use
```bash
node .claude/harness/bin/harness.js init --verify "npm test" --task-file spec.md --protect acceptance/ --max 15
# ... agent works; Stop hook loops it until green or halted ...
node .claude/harness/bin/harness.js status
node .claude/harness/bin/harness.js off      # human escape hatch
node .claude/harness/bin/harness.js restore  # after a crash: put the last checkpoint's files back (fetches from origin if needed)
```
Or `/harness-build <spec> --verify "<cmd>"`. Start Claude with `--permission-mode auto` (or `acceptEdits` + the allow list
in `.claude/settings.json`), never `--dangerously-skip-permissions`.

## Strong verify (`bin/verify.js`)
`--verify "node .claude/harness/bin/verify.js"` with a `verify.config.json` (see `examples/todo-api/`). Five checks, in order:
1. **Tests**: exit 0, none skipped or todo, at least `minTests` ran. Then **replicates** (`replicates`, default 2): the same command runs again and must give the same pass/fail counts, otherwise the gate is noise and is rejected as flaky. `--fast` skips the extra runs.
2. **Source coverage**: line coverage of `srcDirs` only, from raw V8 coverage across *all* processes (so a server spawned by an acceptance test counts). Total and per-file floors.
3. **Test quality**: each test file in `testQuality.dirs` must reference `src/`, contain at least N real assertions, and no tautologies (`assert.ok(true)`) or skips. This is what rejects a placeholder `smoke.test.js`.
4. **Holdout** (optional, `"holdout": {"command": "node --test \"/abs/holdout/*.test.js\"", "minTests": 1}`): hidden acceptance tests run only here, only after checks 1-3 pass. The agent is told just `holdout: K of N hidden acceptance test(s) fail`: no names, paths or expected values. An empty or deleted holdout fails. `--fast` skips it.
5. **Mutation spot-check**: flips one operator (`===`/`!==`, `&&`/`||`, `>=`/`>`, `true`/`false`) in a copy of `src/` for a seeded sample of mutants; the suite must fail on at least `minKillRate` of them. Survivors are printed as `file:line op -> op`, which is concrete feedback for the agent. A mutant that hangs the suite counts as killed; the timeout is 3x the healthy run time (floor 10 s).

`--fast` skips replicates, holdout and mutation for quick iteration; the full run is the definition of done. Protect `verify.config.json` and `acceptance/` with `--protect`; the script itself is already read-only under `.claude/`.

Requirements and limits: Node/`node:test` projects (JS only; the mutation run copies `srcDirs`, the test dirs and `mutation.copy` to a temp dir, first proves that copy passes its own tests, and never touches your real files); a child process that is killed by a signal writes no coverage, so servers must handle `SIGTERM` and exit 0 (the gate says so when a file shows 0%); the mutation operator set is small and equivalent mutants make 100% unrealistic, hence a 60% default floor; the sample changes with the source (seeded from it) so the agent cannot memorise it. Not covered: logic placed outside `srcDirs`, TypeScript, and deleting a source file (set `coverage.minSourceFiles`; the git-tracked list is not consulted).

## Holdout set (`--hide`)
```bash
node .claude/harness/bin/harness.js init --verify "node .claude/harness/bin/verify.js" --hide /abs/path/holdout --protect acceptance/
```
The human writes extra acceptance tests from the spec and keeps them **outside the project tree** (recommended). `--hide` makes the harness refuse, while a run is active, the Read/Grep/Glob tools and any shell command that names those paths (`hooks/pre-read.js`, `lib/guards.js`). A hidden path inside the project is also made read-only, but a repo-wide Grep can still surface its lines, so keep it outside. This is the analogue of a train/test split: the agent iterates against the visible acceptance tests and is graded once on cases it has not seen.

## Tuning model and effort (`bin/tune.js`)
```bash
node .claude/harness/bin/tune.js --task-file spec.md --verify "node .claude/harness/bin/verify.js" \
  --candidates "claude-opus-5-5:low,claude-sonnet-5-5:low,claude-sonnet-5-5:high" --trials 2
```
Commit the spec and acceptance tests first: each trial runs `claude -p --model … --effort …` in a fresh worktree of `HEAD`, then the verify command grades it. Output is a table of pass rate, mean cost (from `--output-format json`) and mean time, the cheapest candidate that meets `--min-pass-rate` (default 100%), and `.harness/tune-report.json`. `--agent-cmd` replaces the default command (it receives `$HARNESS_MODEL`, `$HARNESS_EFFORT`, `$HARNESS_PROMPT_FILE`). This spends real tokens: use a small spec, and trials >= 2 when results are noisy. The rule of thumb to test is that a stronger model at low effort beats a weaker one at high effort on cost.

## Held-out tests: environment variable (`HARNESS_HIDDEN_DIR`)
The other way to hold out tests, besides `--hide` above. Use `--hide` when the harness starts the run; use this when you launch `claude` yourself and want the path kept out of `state.json` too. Both are enforced by the same read guards, and either can be used alone.
A visible acceptance suite can be read, and a strong model will satisfy it. A **held-out suite** checks the same rules on
inputs the agent has not seen, so "underspecified" actually bites. Put the tests in a directory **outside the project**,
and start the agent with the path in an environment variable that only the `claude` process carries:

```bash
HARNESS_HIDDEN_DIR=/abs/path/to/held-out claude -p "..."      # verify.config.json: "... \"$HARNESS_HIDDEN_DIR/*.test.js\""
```
While a run is active, shell commands and `Read`/`Grep`/`Glob` calls that name that directory or the variable are blocked
(`hooks/pre-read.js`, `lib/guards.js`). The held-out tests run inside `verify.js` (and so inside the Stop hook), and their
failing assertions come back in the verify output; that is the intended feedback channel. They resolve the project from the
current directory (`path.resolve('src/...')`), so they also run against the mutation copy. See `examples/sheet-engine/`.
Limits: this stops a good-faith agent from reading the suite, not a determined one, and every failure reveals one expected value.

## Test
```bash
node --test .claude/harness/test/*.test.js
```

## Known limits (be honest about these)
- **Verify is only as strong as your tests.** With a plain `npm test` verify, an agent can pad with a placeholder test (seen live: `tests/smoke.test.js` asserting `true` passed an 80% coverage floor measured over test files). The strong verify closes that gap for Node projects; for other stacks write an equivalent gate. Acceptance tests written from the spec and protected with `--protect` remain the most important defence.
- **Shell guards are heuristic.** `lib/shell.js` is a best-effort parser, not a shell: variable indirection (`X=main; git push origin $X`), decoded payloads, and scripts written then executed get through. Pair with isolation (container/worktree, no prod credentials, network allowlist) and server-side branch protection + required CI.
- **Known gaps found by review and left open** (documented, not fixed): `git apply`/`patch`/`tar -C`/`unzip -d`/`find -exec` writes into protected paths; a read-only `node -e` that merely mentions a protected path is blocked (false positive, by design); `--force-with-lease` is blocked even on feature branches. Closed since: bulk staging of `.env` (`git add -A`, `commit -a`), `git clean`, deleting or moving `main`, `core.hooksPath` and `HUSKY=0`, `pkill`/`killall`, `>|` redirects. Bulk-staging detection runs `git status`, so a secret that is gitignored is correctly not flagged.
- **Allow list no longer has `Bash(node:*)`.** It let any `node -e` script bypass the shell guards. Only `node --test` and the harness `report.js` / `verify.js` are pre-approved; anything else asks.
- **Hiding is heuristic.** The agent can still find a hidden path by guessing at it from the shell in ways the parser cannot see (see the shell-guard limit above). Isolation is the real answer; hiding raises the cost of overfitting, it does not make it impossible.
- **Replicates add test-suite time** (default 2 runs per Stop attempt). Set `replicates: 1` for very slow suites.
- **Diagnosis relies on `node:test` output** for grouping (spec or TAP reporter); other output falls back to the raw tail.
- **Checkpoints are local unless `--checkpoint-push`.** A local ref survives a crashed agent or lost context, not a lost container. `restore` copies files back but does not delete files created after the checkpoint. Gitignored files are not captured.
- **The Stop feedback sends the full spec once** (first block); later blocks carry only a pointer plus the verify-output tail, so context does not grow by one spec copy per iteration.
- **Hooks fail open** on internal crashes (exit 1) so a bug cannot brick a session (each crash is written to `.harness/hook-errors.jsonl` and shown in the report). A *corrupt state file* is stricter: guards stay on, commits are refused, and the Stop hook blocks once (then lets the session end, since the agent cannot repair `.harness/`).
- **Gate files are always read-only during a run**: `verify.config.json`, `acceptance/` and `spec.md` are protected by default, in addition to any `--protect` paths.
- **Timeouts:** verify defaults to 600 s (`--verify-timeout SECONDS` to change); the Stop and commit hooks time out at 900 s in `settings.json`. Keep the verify budget (tests plus mutation samples) below that.
- **Per-edit lint:** `init --lint "<cmd>"` runs the command after every Write/Edit (`hooks/post-edit.js`) and sends failures back to the agent with exit 2. Exit 1 would not block.
- **Sandbox:** `settings.json` enables the OS sandbox for Bash and its child processes (credential dirs unreadable, network limited to npm and GitHub). Hooks cannot see what `npm test` reads; the sandbox can. **It needs `bwrap` and `socat`; without them Claude Code silently runs commands unsandboxed** and only the deny rules and shell guards apply. `init` warns when this is the case, and `init --require-sandbox` refuses to start instead. Verify the key names against your Claude Code version.
- **Trust the workspace first.** Non-interactive runs (`claude -p`) ignore the project `permissions.allow` list until the workspace is trusted, so the agent cannot even run `node --test` or `verify.js` and is graded blind (seen live: the Stop hook still passed the run, but the agent could not test its own work). Open Claude Code in the project once and accept the trust dialog, or set `projects["<dir>"].hasTrustDialogAccepted` in `~/.claude.json`. `init` warns when the workspace is not recorded as trusted.
- **Failure output matters as much as the gate.** A live run showed an agent spending about ten attempts reading a verify tail that said only "tests failed (3 failing)". `verify.js` now ends with a "Failing tests" section (names, error, expected/actual), and the Stop hook forwards up to 70 lines / 5000 characters.
- **Every Stop attempt costs an iteration**, including when the agent stops to ask a human a question; with no human that is wasted budget, so tell the agent not to ask.
- **No cost cap yet.** Time and iterations are capped (`--max`, `--max-minutes`); dollars are not. Bound spend with account/session limits, and use `tune.js` to find a cheaper model/effort.
- **The time budget is checked at Stop attempts**, so one long agent turn can overrun it; it is not a watchdog.
- **No evaluator-score gate yet.** `gan-evaluator` feedback is advisory; only the verify command is enforced.
