# Seed idea: RED STRING

The original prompt, verbatim: "lets use this chance to reimagine the app and get it wild, no idea limits.
as long is fun and you and i would like it."

The repo was an empty Pinterest proof of concept. The reimagining, chosen by the orchestrating agent:

**RED STRING: a pinboard for people who have connected the dots.**

- No feed and no grid. The board is a cork wall, the kind a detective keeps in the garage.
- A pin is conjured from a word or phrase. The app draws a unique piece of generative art for it,
  deterministically (same phrase, same art), so there are no uploads, no stock photos and no network images.
- Pins are objects: drag them, throw them, they have weight and tilt and hang from a pushpin.
- Pull a red string between any two pins and the app issues a deadpan "connection" stating, with total
  confidence, how the two are related. Same pair, same finding.
- The wall has a Conspiracy Score and a case status that escalates as the strings pile up
  ("Hunch" -> "Theory" -> "They don't want you to know").
- "Ask the Detective" proposes the next string for you.
- A wall is shared by link. Friends who open it see pins and strings arrive live and can add their own.
- "Close the case" produces a case file: a printable one-page summary of the evidence and the findings.

Constraints for this run: Node 22, zero runtime dependencies, `node:test`, so the harness verify gate
(tests, coverage, test quality, hidden holdout, mutation) can judge it. No logins, no personal data, no money.
