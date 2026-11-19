---
description: "Score recorded sessions, then have a read-only agent propose one evidence-backed improvement to a skill, rule or agent."
---

# /harness-improve

The learning loop: record -> score -> find failures -> propose -> measure.

1. Show the current scores:
   ```bash
   node .claude/harness/bin/report.js
   ```
   If it says "No sessions recorded", stop: traces appear after normal sessions with the PostToolUse hook enabled.
2. Launch the `harness-improver` agent. It reads the report and traces and returns ONE proposal. It cannot edit files.
3. Show the proposal to the user. Do not apply it unless they approve.
4. On approval: create a branch, make exactly the proposed edit, and open a PR (do not merge). `.claude/` changes are
   flagged by the protected-files check, so a human reviews them.
5. After the user merges it, record the change so later reports show whether it helped:
   ```bash
   node .claude/harness/bin/report.js --mark "<short label of the change>"
   ```
