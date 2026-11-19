# Testing

- Coverage floor: 80%, enforced by the verify command during unattended runs, not by this note.
- Acceptance tests (`acceptance/`) are human-written and read-only during a harness run. Add unit tests beside the code; never edit or weaken an acceptance test to make it pass.
- Fix the implementation, not the test, unless the test is demonstrably wrong.
- Name tests after the behavior: `returns empty array when no markets match query`.
