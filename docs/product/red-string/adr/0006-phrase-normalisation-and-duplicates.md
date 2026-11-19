# 0006 Phrase normalisation; duplicate phrases allowed
Status: accepted (2026-11-19)
## Context
Phrases are user text shown in HTML, SVG-adjacent UI and print; limit is 60 characters.
## Decision
NFC, strip control and zero-width characters, collapse whitespace, trim, 1..60 code points. Display keeps case; art/finding key is lower case. The same phrase may be pinned twice on one wall (separate ids, same art).
## Alternatives
Reject duplicates (adds an error the UX has no copy for); count UTF-16 units (emoji would count double).
## Consequences
Tests should use distinct phrases when selecting by `data-phrase`.
