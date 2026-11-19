# 0003 Score formula and status thresholds
Status: accepted (2026-11-19)
## Context
Brief: score from pins, strings and a bonus for well-connected pins. ux UC1/UC8 require 0 for a wall with pins but no strings; UC10 needs level 4 within 8 pins / 28 strings and Theory by about 4 strings.
## Decision
`score = 10*S + 2*C + 5*Σ max(0, deg-1)` where C = pins with at least one string. Thresholds 0/20/60/120/200 for Hunch/Theory/Pattern/Cover-up/"They don't want you to know".
## Alternatives
Counting every pin (breaks UC1/UC8); pure string count (no hub bonus as brief asks).
## Consequences
2 strings reach Theory; a full 8-pin wall scores 536; adding a string never lowers the score.
