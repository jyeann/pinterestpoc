# 0002 SSE with full snapshot on connect, last write wins
Status: accepted (2026-11-19)
## Context
Live sharing within ~1 s, zero dependencies, toy-level consistency.
## Decision
One SSE stream per wall viewer. A `snapshot` event on every (re)connect, then delta events carrying `version` and `by` (X-Client-Id). No Last-Event-ID replay. Concurrent moves: last write wins.
## Alternatives
WebSocket (needs a hand-rolled framing implementation); polling (slower, chattier); event replay log (more state for little gain).
## Consequences
Reconnect is simple and always correct; pins may jump under concurrent drags (accepted in brief).
