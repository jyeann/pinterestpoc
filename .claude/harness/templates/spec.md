# Spec: <name>

> The spec is the contract. Everything the run must satisfy is written down here as a
> machine-checkable criterion. If it cannot be checked by a command, it is not a requirement.

## Goal
<2-3 sentences: what exists when this is done, and for whom.>

## Interface (exact, so acceptance tests can be written before the code)
<routes / CLI flags / env vars / file formats / exported functions, with request and response shapes.>

## Acceptance criteria
Each line maps to at least one test in `acceptance/` (written by a human or the planner, never the generator).

1. <criterion> -> `acceptance/<file>`: "<test name>"
2. ...

## Out of scope
<what NOT to build; prevents gold-plating.>

## Verify command (definition of done)
```
<one command that exits 0 only when every criterion passes, plus lint/type/coverage gates>
```

## Constraints
- Dependencies: <none | allowed list>
- Never commit secrets; read config from environment variables.
- Work only on branch `<branch>`; never push to main.
