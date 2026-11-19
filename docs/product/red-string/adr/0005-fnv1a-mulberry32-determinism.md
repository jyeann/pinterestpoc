# 0005 FNV-1a 32 + mulberry32 for all determinism
Status: accepted (2026-11-19)
## Context
Same phrase -> same art; same unordered pair -> same finding; detective must be a fixed rule. Must be stable across Node versions and restarts.
## Decision
`fnv1a32` over UTF-8 bytes with domain prefixes (`art:`, `finding:`, `detective:`, `pos:`), seeding `mulberry32`. Keys are normalised lower-case phrases; pairs are sorted keys joined by U+0000.
## Alternatives
`crypto.createHash` (fine but heavier to reason about for small ints); `Math.random` with seed (not available).
## Consequences
Tiny, pure, unit-testable with known vectors; not cryptographic (not needed).
