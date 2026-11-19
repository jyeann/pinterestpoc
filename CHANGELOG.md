# Changelog

## 1.0.0 - 2026-11-19

First release of RED STRING, a conspiracy corkboard. Node 22 or later, no runtime dependencies.

### Features

- **Walls:** create a case with a shareable link (`/w/<id>`). Titles are up to 60 characters.
- **Pins from phrases:** a phrase becomes a pin with deterministic SVG art. The same phrase always gives the same art. Nothing is uploaded or fetched.
- **Pins as objects:** drag pins to move them, delete them, and see them hang from a pushpin with a resting tilt.
- **Red strings:** tie two pins to draw a string. Each pair gets a fixed deadpan finding that does not depend on the order of the pins. Strings can be read and cut.
- **Conspiracy Score and case status:** the score rises with pins and strings, with a bonus for well-connected pins. The status moves through Hunch, Theory, Pattern, Cover-up and "They don't want you to know".
- **Ask the Detective:** suggests the next string to tie, or says why it has none.
- **Shared live wall:** everyone with the link sees pins, strings, moves and removals as they happen (Server-Sent Events, with a snapshot on connect and on reconnect).
- **Case file:** `/w/<id>/case` shows a printable one-page summary of the evidence, findings and score.
- **Themes:** day and night, following the system setting and switchable from the header.
- **Optional persistence:** set `RED_STRING_DATA` to save walls to a JSON file, written atomically and loaded on restart. A corrupt file is moved aside, not overwritten.
- **Limits and safety:** 100 pins and 500 strings per wall, 10 000 walls per process, 4 KB request bodies, a token-bucket rate limit on writes (`RATE_LIMIT=0` turns it off), strict Content-Security-Policy, and no user data in logs.
- **Graceful shutdown:** `SIGTERM` and `SIGINT` save pending changes, close streams and exit with code 0.

### Review fixes

Found by the code, security, performance and accessibility reviews before release:

- **Front end:** a pin removed by someone else during a drag no longer blocks dragging; a slow first load can no longer overwrite newer live state; a double Enter no longer creates two pins; one failed request no longer stops later pin creation; a pin or string removed by someone else is reported plainly; the title no longer overwrites text typed after Enter (fixed in code, not yet checked in a browser or with a screen reader).
- **Persistence:** a changed wall accepted during shutdown is saved; a failed save is retried instead of being dropped; duplicate-string checks use sets, so loading large files is fast.
- **Server:** request and header timeouts stop slow clients from holding connections; SSE streams are capped globally (2000) and per address (60); the rate-limit bucket table is capped; a stored `createdAt` is validated on load.
- **Performance:** pointer moves are throttled to animation frames; string layout runs once per frame, not per string.
- **Accessibility:** the 404 action button is styled and sized; string focus rings and the Day string colour now meet 3:1 contrast on the cork; open panels no longer cover the focused pin or string; connection changes and errors are announced; Detective suggestions are read when focus lands on "Tie it"; the wall has a `<main>` landmark and heading; pins have key hints and role descriptions.

### Known limits

- Not hardened for the open internet. Run it on your own network.
- Walls are never evicted, and anyone with the link can edit.
- The per-address stream cap (60) is above the 50 viewers per wall, so one client can take a whole wall.
- The rate limit keys on the socket address only.
- Saving rewrites the whole data file on each change.
- No pointer "Move" control for pins yet.
