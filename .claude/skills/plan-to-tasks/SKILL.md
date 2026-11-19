---
name: plan-to-tasks
description: Break a plan, PRD or grill-me design summary into a TASKS.md of independently grabbable vertical slices with blocked-by links and AFK/HITL labels that the build loop can consume. Use after planning and before implementing a standard or large task, or when a flat task list needs dependencies.
metadata:
  origin: local (adapted from Matt Pocock's workflow)
---

# Plan to Tasks

Turn a destination (plan, PRD or design summary) into a **backlog the loop can work through**, not a numbered
multi-phase plan. A numbered plan can only be picked up by one agent in order; a backlog with blocking links can be
worked unblocked-first and, later, in parallel.

Format reference: `.claude/harness/templates/tasks.md`. Parser and picker: `node .claude/harness/bin/next-task.js`.

## Procedure

1. **Locate the input**: the grill-me design summary, the `planner` output, or a spec file. If a fresh session,
   explore the code just enough to name real modules and files.
2. **Draft vertical slices.** Each task cuts through every layer it needs and ends in something runnable and
   checkable (a visible UI change, a passing end-to-end test, a working endpoint). Reject horizontal tasks
   such as "create the schema" or "build the service" on their own.
   - The **first** slice must be a thin end-to-end path through the whole feature, even if it is minimal. It is the
     tracer bullet that gives the agent real feedback early.
   - Prefer many thin slices to a few thick ones. A slice should fit in one agent context (well under ~100K tokens).
3. **Label each task** `AFK` (an agent can finish it alone) or `HITL` (needs a human: product decision, credentials,
   manual QA, visual judgement). Planning and QA are human work; implementation is usually AFK.
4. **Set `blocked-by`** to the minimum real dependencies, so independent slices stay independent.
5. **Quiz the user** on the draft in one message: granularity too coarse or fine? dependencies right?
   AFK/HITL labels right? Revise until approved. This is the human gate for the backlog.
6. **Write `TASKS.md`** (repo root, or the path the user chose) and run
   `node .claude/harness/bin/next-task.js TASKS.md` to prove it parses and that at least one task is ready.

## Rules

- Every task states how to know it is done and which module interface its tests go through.
- Do not put secrets, credentials or destructive commands in a task. Tasks are data, not instructions to bypass guards.
- QA findings later become new tasks appended to the same file, with `blocked-by` where needed.
- When the work lands, delete `TASKS.md` and any PRD or plan files. Old plans left in the repo go stale and mislead
  the next agent that finds them; git history keeps them if ever needed.
