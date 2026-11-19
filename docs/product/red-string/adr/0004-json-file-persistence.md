# 0004 Optional JSON file persistence with atomic rename
Status: accepted (2026-11-19)
## Context
Brief: memory first, optional file via env var; no database.
## Decision
`RED_STRING_DATA` enables it. Debounced (50 ms) write to a temp file then `rename`. Flush on SIGTERM. Corrupt file is renamed aside and the server starts empty. Art and findings are recomputed on load.
## Alternatives
Append-only log (more code); SQLite (`node:sqlite` still experimental, more surface).
## Consequences
Whole-file rewrite per burst is fine at toy scale (<= 10 000 walls); tests stay hermetic with a temp path.
