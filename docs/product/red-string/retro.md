# Retro: red-string

This run had two goals: build something fun from "reimagine the app, no idea limits", and test the
`orch-product-team` workflow from `jyeann/claude-setup` in a repo that is not claude-setup.

## Outcome

RED STRING, a conspiracy-corkboard pinboard, built from a one-line prompt in an empty repo. Zero runtime
dependencies. All nine phases ran.

| Check | Result on the final code |
|---|---|
| Tests (acceptance + unit) | 285 of 285 pass, two runs agree |
| Source line coverage | 99.27% (floor 80%) |
| Hidden tests | 19 of 19 |
| Mutation spot-check | 8 of 8 killed (floor 60%) |
| Browser walkthrough (16 journeys, 23 UI checks, extras) | 52 passed, 0 failed, 1 skipped of 53. The skip is the axe-core scan: not installed |
| Reviews | No CRITICAL. 2 HIGH (accessibility): 1 fixed, 1 did not reproduce in a browser. MEDIUMs fixed or accepted with a reason in `reviews.md` |

Not done or not proven: no automated accessibility scan; no screen-reader pass; the per-address stream cap
does not bind by default; walls are never evicted; phone layout still allows partial overlap (see `qa.md`).

## Phases and cost

20 agent runs were recorded by `agents-kpi.js` (`kpi.json`). It has token figures for only 7 of them (451k
tokens); the other 13 ran in the background and show "outcome not reported". Adding the figures from their
completion notices, the delegated work used about 1.66M tokens. The orchestrator's own usage is not counted.

| Phase | Runs | Tokens (kpi.json + completion notices) | Notes |
|---|---|---|---|
| discover | 1 (+1 refused) | 74k | `product-scoper` agent type was not registered yet; ran as general-purpose |
| ux | 1 | 87k | |
| design | 1 | 103k | architect given Write, saved verbatim |
| plan + tests | 2 | 91k + 203k | independent test owner: 107 acceptance, 19 hidden |
| build | 3 builders | 377k | green on the first full gate |
| review | 4 reviewers | 258k | |
| fix rounds | 4 agents | 264k | review fixes, then QA round trips 1 and 2 |
| qa | 1 (resumed once) | 100k+ | stopped by a usage limit, resumed after reset |
| release | 1 | 80k | |
| retro | 1 | 21k | |

Human prompts: 2 (the request, then "keep going until its built"). The KPI view counts the second as 1
intervention. It came while the orchestrator had ended a turn to wait for a background agent, so by the
skill's own rule ("a stop to ask a human is a defect") this run does not meet the zero-intervention bar.

## What worked

1. **The test owner before the builders.** 126 tests existed and were red before any code. Three builders
   working in parallel against written module interfaces produced a build that passed the full gate,
   hidden tests included, without a fix iteration. Harness iteration count stayed at 0.
2. **Architect with Write.** The change proposed by the hello-overkill retro was applied; no hidden test
   contradicted the design this time.
3. **Reviews given `ux.md` as hard requirements.** Two accessibility findings were marked ESCALATE instead
   of being applied against the spec.
4. **Browser QA found what 285 tests did not:** a new pin covering the previous pin's buttons, and the tie
   hint swallowing taps on phones.
5. **The KPI roll-up recorded runs this time** (the two hello-overkill retros reported 0 runs).

## What went wrong, with evidence

1. **Foreground agents still ran in the background.** 13 of 20 runs. With a harness run active, ending the
   turn to wait would re-run verify and spend an iteration, so the orchestrator held each turn open with a
   blocking shell wait on file activity. Limits were loosened to `--max 30 --stall 6` in anticipation
   (decision 10); in the end 0 iterations were used.
2. **A real defect was dismissed as a flake.** A fix agent saw `J11.sigterm` fail once and moved on. It
   failed on both orchestrator re-runs. Cause: the server printed "listening" before installing its SIGTERM
   handler (about 1 in 5 immediate stops died uncleanly). Fixed in `src/main.js`; 40 of 40 afterwards.
3. **QA checked overlap at one width.** Check X6 ran at 1280x800 only. The same defect at phone width
   (wall full after about four cards) was found by the orchestrator looking at a screenshot. It cost a
   second round trip and is only mostly fixed.
4. **The hidden-path guard blocks on text, not access.** Two orchestrator commands were refused because a
   commit message and a grep pattern contained the hidden directory's name. The `guardrail-attempts`
   scorer then reads 0% for a session with no attempt to read hidden tests.
5. **`pre-bash` failed open 5 times** ("Expected property name or '}' in JSON", `.harness/hook-errors.jsonl`).
   Those commands ran unchecked. Cause not diagnosed.
6. **A review fix was neutralised by an acceptance test.** The per-address stream cap was set to 60 because
   a read-only acceptance test opens 50 streams from one address. The finding is recorded as only partly fixed.
7. **One harness self-test cannot pass outside claude-setup:** `ci/ruleset.json` requires CI jobs named
   `gate-link-shortener`, `gate-retro-board` and `eval-kit-selftest`. 276 of 277 pass here.
8. **Setup copied mid-session loads unevenly.** Hooks were live at once; skills and agent types appeared
   only later, so phases 1 to 4 ran as general-purpose agents told to read the agent file.
9. **A usage limit stopped QA mid-run.** No `status.md` was written and no resume was scheduled, as the
   skill asks; the session was restarted two hours after the reset and the agent was resumed then.

## Proposed change (ONE, evidence-backed, from `harness-improver`)

Add to `orch-product-team` phase 7:

> QA rules. (1) Run every layout or overlap check (anything that asserts "does not cover", "fits",
> "reachable") at 1280x800 and at 390x844, and record both results in `qa.md` as separate rows. (2) A check
> that fails once is a defect until it passes 10 consecutive immediate runs. A fix agent may not label a
> failure "flake" or "environment": reproduce it and fix it, or write the evidence in `qa.md` and let the
> orchestrator decide.

Evidence: items 2 and 3 above. How to tell it worked: the next run's `qa.md` has paired rows per overlap
check, and the count of defects found after the QA phase (3 in this run: D3, D4, and the phone remainder) drops.

Not applied in this repo: `.claude/` here is a copy, and the change belongs in claude-setup.

## For a human to decide (outside what an agent may change)

- The hidden-path guard matching on text (item 4) and the `pre-bash` parse failures (item 5): harness code.
- `ruleset.json` job names (item 7): make them per-repo, or skip that test when the jobs are absent.
- Whether a prompt that arrives while the orchestrator is only waiting should count as an intervention.

## Follow-ups for the product

- Phone layout: positions are a fraction of the board box, so a taller phone board moves earlier cards.
  A real fix is a layout rule per viewport, which is a design change.
- A pointer "Move" control for touch screen-reader users (accessibility A8).
- Eviction of idle walls and a per-address stream cap that binds, before any public deployment.
- An axe-core run and a manual screen-reader pass.
- Unit-testable placement logic (`freeSpot`, `fitBoard` live in the browser script with no unit test).
