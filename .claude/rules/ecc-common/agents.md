# Agents

Agents live in `.claude/agents/` and are called through the Agent tool by name (for example `planner`, `code-reviewer`, `security-reviewer`, `tdd-guide`, `build-error-resolver`). List them with `ls .claude/agents`.

- Delegate when it earns its cost: independent work that can run in parallel, or a review that needs fresh context. Do not delegate trivial edits.
- Run independent agents in parallel.
- The agent that delegates owns the result: wait for its children, integrate their output, and finish with the deliverable. Never end a turn with "waiting for background agents".
- In an unattended harness run, do not insert planning or review hops that the spec did not ask for; each Stop attempt costs an iteration.
