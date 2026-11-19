# Tasks

> One heading per task: `## <id>: <title>`, then `- key: value` lines. Anything else is ignored.
> `node .claude/harness/bin/next-task.js TASKS.md` lists the AFK tasks that are ready (exit 0),
> or prints ALL_DONE / NEEDS_HUMAN / STUCK (exit 3), or lists format errors (exit 2).
>
> - type:       `AFK` = an agent can finish it alone. `HITL` = needs a human (design call, credentials, manual QA).
> - blocked-by: comma-separated task ids, or `none`.
> - status:     `todo` | `doing` | `done` | `blocked`. The agent sets `done` in the same commit that finishes the task.
>
> Each task is a **vertical slice**: it cuts through every layer it needs (schema, service, API, UI) and ends in
> something you can run and check. Never write "all the schema" or "all the UI" as a task.

## T1: Award points for lesson completion, visible on the dashboard
- type: AFK
- blocked-by: none
- status: todo

Done when: completing a lesson adds points and the dashboard shows the total.
Touches: new `gamification` module (deep: small interface, logic inside), progress route, dashboard route.
Tests: through the `gamification` interface, not its internals.

## T2: Streak tracking
- type: AFK
- blocked-by: T1
- status: todo

## T3: Choose level thresholds
- type: HITL
- blocked-by: none
- status: todo

## T4: Retroactive backfill of existing progress
- type: AFK
- blocked-by: T1, T3
- status: todo
