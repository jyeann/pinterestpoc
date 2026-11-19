---
name: orch-product-team
description: Run a product the way a small company would - discover and scope, design the experience, design the system, plan, build under the verify gate, review in parallel, walk the product as a user, document, and hold a retro - with one human gate (final acceptance), every other decision made by an agent and logged, and per-phase cost, effort and human-touch measurement. Use when a new product or large feature starts from an idea rather than from a finished spec.
metadata:
  origin: local
---

# orch-product-team

The `orch-*` skills assume a spec already exists. This one covers the work before the spec and after the
build, and replaces the human approval gates with logged agent decisions so an unattended run is not
interrupted. Build and verify still go through the harness (`/harness-build`, `verify.js`).

## Principles

- **One human gate: final acceptance.** Scope, design, plan and commit approvals are agent decisions. Each is written to `docs/product/<slug>/decisions.md` as: decision, options, chosen, why, decided by. Ask a human only for spend, legal or real personal data.
- **A stop to ask a human is a defect.** The `UserPromptSubmit` hook counts human prompts; every prompt after the first in a session is an intervention and shows in the KPI view. Do not end a turn to ask "shall I continue?".
- **Delegated agents run in the foreground** so tokens, time and outcome are recorded. Background runs show as "outcome not reported".
- **Tag every delegated agent** with its phase: `description: "[phase:design] ..."`. The KPI roll-up groups cost by this tag. Pass `effort` explicitly (see Effort).
- **Done means a person can use it.** The build is not finished until phase 7 has executed every journey in `ux.md` in a real browser and they pass.

## Starting the build run

`node .claude/harness/bin/harness.js init --verify "cd examples/<p> && CLAUDE_PROJECT_DIR=$PWD node ../../.claude/harness/bin/verify.js" --task-file examples/<p>/spec.md --protect examples/<p>/acceptance/,examples/<p>/verify.config.json,docs/product/<p>/ --hide examples/<p>/holdout --max 14 --stall 3`. The holdout lives in the repo so every gate and CI can run it; `--hide` keeps it from the agent while the run is active. Stay in the turn while a builder works: ending it makes the Stop hook re-run verify and count identical red results toward the stall breaker.

## Phases, roles, artifacts

| # | Phase tag | Who | Output (under `docs/product/<slug>/`) | Exit check |
|---|-----------|-----|----------------------------------------|------------|
| 1 | `discover` | `product-scoper` | `brief.md` | build/adopt/extend decided; success criteria are user-visible and testable |
| 2 | `ux` | `ux-designer` (+ `a11y-architect` for review) | `ux.md` | every success criterion has a journey and a UI acceptance check |
| 3 | `design` | `architect`, `api-design` skill; record choices with `architecture-decision-records` | `design.md`, `adr/` | interfaces, data, failure modes, security notes written; ADR per real choice; `architect` is read-only, so save its text verbatim (a writer agent given the exact text, a diff-free check, or give it Write). Never retype or shorten it: a dropped caveat reached the holdout author and failed a gate |
| 4 | `plan` | `planner`, then `plan-to-tasks` | `TASKS.md`, spec and acceptance tests | acceptance tests exist, fail for the right reason (RED), written by an agent other than the builder |
| 5 | `build` | `tdd-guide` / `gan-generator` under `/harness-build` | code, unit tests | `verify.js` exits 0 (tests, coverage, mutation, holdout) |
| 6 | `review` | `code-reviewer`, `security-reviewer`, `a11y-architect`, `performance-optimizer` in parallel, foreground | `reviews.md` | no CRITICAL or HIGH open; MEDIUM fixed or logged with a reason; every reviewer is given `ux.md` as a hard requirement list, and a finding that contradicts it is escalated, not applied |
| 7 | `qa` | `e2e-runner` (Playwright) or `gan-evaluator` | `qa.md`, screenshots | every journey and UI acceptance check in `ux.md` passes in a browser |
| 8 | `release` | `doc-updater` | README with run steps, `CHANGELOG` entry | someone with only the README can run it |
| 9 | `retro` | `harness-improver` + the KPI roll-up | `retro.md` | one evidence-backed change proposed; KPI file refreshed |

Phases 1-4 run before the harness run starts; 5 runs inside it; 6-9 run after verify is green. A failing phase 6 or 7 sends the work back to 5 with the failing journey or finding as the task. Cap the loop at 3 round trips, then halt and report.

## Right-sizing

Small fixes and single-file changes do not need phases 1-4: use `orch-fix-defect` or `orch-change-feature`. Run this skill for a new product or a feature with a user-facing surface. A change that touches a screen always runs 2 and 7.

## Effort (measured defaults, sonnet, one product)

From the per-phase comparison on the retro board (`docs/product/retro-board/effort-by-phase.md`, 24 cells of 1 to 2 trials, objective graders):

| Phase | Default | Why |
|---|---|---|
| discover, ux, design, release | `low` | All levels passed; `high` cost 1.4x to 2.0x for no measured gain |
| review, qa | `low` | All levels passed the seeded-defect graders; `high` cost 1.5x. Use `high` for auth, input, files and money on judgment: the data does not show it helps |
| tests (test owner) | `medium` | `low` passed 1 of 2; `high` cost 2x `medium` with the same pass |
| build | `low` or `medium`, with the full gate including the hidden holdout | `high` failed the gate 2 of 2: in the one run diagnosed, it missed a rule from the design that no visible test covered (control characters in card text) |

Read this carefully: most graders check coverage by keyword, so "all passed" means the checklist was met, not that the work was equal. Trials are few. Re-run `examples/retro-board/tune/run.js` on a second product before treating any row as settled, and keep a hidden holdout in the build gate: it was the only check that told the effort levels apart on quality.

## Limits and resuming

When a usage limit stops an agent, write the state to `docs/product/<slug>/status.md` (phase, what is done, what is next), schedule a resume with `send_later` at the reset time, and continue with `SendMessage` to the stopped agent. Do not wait for a human to say "try again".

## KPI proof

After phase 9, run `node .claude/harness/bin/agents-kpi.js --out kpi.json`. It reports per agent, per phase and per model/effort: runs, failures, outcome-not-reported, tokens, time; plus human prompts and interventions. A run is credible only if the KPI file shows foreground, tagged, effort-stamped runs and zero interventions after the first prompt.
