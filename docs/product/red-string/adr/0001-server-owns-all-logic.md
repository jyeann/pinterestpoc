# 0001 Server owns all logic; browser only renders
Status: accepted (2026-11-19)
## Context
The verify gate measures coverage and runs mutation only on `src/`. Art, findings and score must be the same for every viewer.
## Decision
Art SVG, findings, score/status and detective picks are computed by small CommonJS modules in `src/` and sent in JSON (`pin.art`, `string.finding`, Meta). `public/` holds no copy of this logic.
## Alternatives
Generate art in the browser (dupes code, untested by the gate, can drift).
## Consequences
Pin JSON is bigger (~1-2 KB art per pin); one source of truth; all logic testable over HTTP and in unit tests.
