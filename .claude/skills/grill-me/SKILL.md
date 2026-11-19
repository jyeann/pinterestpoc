---
name: grill-me
description: Interview the user relentlessly about a plan, feature idea or brief until you share an understanding, recommending an answer to every question, one question at a time. Use before planning any standard or large task, when a request has open decisions, or when the user says "grill me".
metadata:
  origin: local (adapted from Matt Pocock's workflow)
---

# Grill Me

Goal: reach a **shared understanding** with the user before any plan or code exists.
Plans are cheap to produce and expensive to get wrong; alignment is the real deliverable.

## When to use

- A standard or large task (see the size tiers in `orch-pipeline`), a vague brief, or a pasted message from a stakeholder.
- Skip for trivial and small tasks where the change is obvious.

## Procedure

1. **Explore first.** If the answer to a question is in the code, read the code instead of asking.
   Use `code-explorer` for broad sweeps so the exploration stays out of this context.
2. **Interview.** Walk down each branch of the decision tree, resolving dependencies between decisions one by one.
3. **One question at a time**, in plain chat. For each question give your **recommended answer** and a one-line reason,
   so the user can reply "yes" or correct you.
4. Surface the nasty questions the user has not considered: backfill of existing data, edge cases, failure modes,
   what happens to current users, what is explicitly **out of scope**.
5. Do not produce a plan, PRD or code while questions remain. Do not stop at "enough"; stop when every branch is resolved
   or the user says to stop. If the user says you are asking too much, pull back and propose defaults for the rest.

## Finish

When the decision tree is resolved, write a short **design summary** in chat:

- Problem and goal (2-3 sentences)
- Decisions made, each with its reason
- **Out of scope** (what was decided against, and why)
- Modules to create or change. Prefer a few deep modules (small interface, logic inside) over many shallow ones, and state the interface of each new one
- Open questions that need a human outside this session

Then hand off: the summary is the input to the `planner` agent and to `plan-to-tasks`.
Do not rewrite it into a longer document; the conversation is the asset, the summary only records it.

## Rules

- Questions are cheap; wrong assumptions are not. Never silently assume.
- A recommendation is mandatory on every question. "What do you want?" alone is not allowed.
- Keep tokens in check: this session can run long. If the context grows past roughly 100K tokens, write the summary
  and continue in a cleared session seeded with it.
