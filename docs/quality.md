# Quality

A grade per area, and where the gaps are. Written to be honest rather than
flattering: an area marked green is one somebody can build on without checking.

Last reviewed: 2026-08-30, at the end of the shipshape-lens task.

| Area | Grade | Where it stands |
| --- | --- | --- |
| Layer boundaries | Green | All seven invariants checked in `npm test`, each with a planted violation proving the check works. Invariant 3 now confines two capabilities: writing, and starting a process. |
| The document contract | Green | All three lenses, a status per lens, pinned and parsed strictly. `tests/document.test.ts` walks every fixture set and asserts the document it produces; the refusal is tested end to end through the built server. The upstream shape has been checked against a live fleet and corrected; three assumptions remain, listed at the end of `docs/contract.md`. |
| The refresh loop | Green | Coalescing, timeout, last-known-good and the signal are tested; scroll preservation demonstrated in a browser, not asserted. |
| Fixtures | Green | Twelve sets, two files each, in the shape upstream actually publishes, plus three synthetic fleet homes under `fixtures/homes/` for the health module to read and for its tests to break. Every state the document can reach has one, including each lens dark on its own; `upstream-shape` uses only the vocabulary a live fleet emits. |
| Theme | Green | Semantic tokens over a palette layer, light and dark, fonts vendored. Not yet exercised by anything more complex than a lens frame. |
| Security baseline | Amber | Host, Origin, CSP and the acting guard are tested. The session secret is minted and required but never handed to a client, because nothing acts yet - the round trip is untested by construction. Action-request identity and replay rejection are similarly untested: `Intent.requestId` exists as a type only, and no wired path reads it. |
| `adapters/health.ts` | Green | Reads a real fleet home as well as the fixture health file, filling all three signals from files that carry no compatibility promise. Every signal has a tested unreadable path, one signal going dark leaves the others working, and a home that is not there darkens the lens alone - `tests/health.test.ts` breaks a copied home three ways and asserts none of it throws. The thresholds are the fleet's own defaults, which is a number to keep in step with upstream rather than a gap. |
| The write path | Red | `intent.ts` holds the type and the marker and writes nothing. `submitIntent` refuses. Deliberate: out of scope for the skeleton. Idempotency is deferred along with it - see `docs/decisions/2026-08-30-security-baseline.md` - and is not enforced today. |
| The deck lens | Amber | Draws all four piles - held, blocked, queued, in flight - from the document, with the empty, stale and unreadable states each saying which they are. Driven end to end through the built server, including both directions of the blocker rule. Amber because a deck row cannot show its project or whether the work is research or build: the document carries neither `project` nor `kind` for a deck record. See `docs/plans/done/2026-08-30-deck-lens.md`. |
| The shipshape lens | Green | Draws all three health signals - supervisor, overdue, drift - each in its `ok` and `unreadable` forms, plus the whole-lens dark state. A supervision cycle alive but silent for longer than the named threshold reads as a concern, not as health; an unreadable signal never implies what it would have said. `tests/shipshape-lens.test.ts` drives every state, including a mixed reading, through the built server. See `docs/plans/done/2026-08-30-shipshape-lens.md`. |
| The fleet lens | Green | The worker card and the lifecycle rail. Every coarse stage and every off-track state has a tone and a place on the rail, the validation step is named with its place in the run, and a halted worker shows the stage it left the track in and upstream's words for why. Stale, empty and unreadable are three different states on screen. `tests/fleet-lens.test.ts` drives all of it through the built server; refresh in place was demonstrated in a browser. |
| Reading a real fleet | Amber | Wired: a configured fleet home, its snapshot command run through the one spawn door, parsed strictly and projected into the fleet and deck parts. Tested two ways with no fleet present - the parsing, refusals and read discipline against a stub runner, and the whole path end to end through the built server against a temporary fleet home holding one script. Amber only because two of upstream's values have no honest home in the frozen document: `unknown`, and a record with no start date. |

## Known gaps

- **Two upstream states have no honest home in the document.** Upstream's
  `unknown` - a torn-down worktree, no source of current state answering - lands
  on `waiting`, and a backlog row with no start date is dated from the moment
  upstream looked. Both are the least wrong value in a frozen vocabulary rather
  than a right one, and both are a document version bump to fix. See
  `docs/contract.md` - open assumptions.
- **`DeckItem` carries neither `project` nor `kind`.** A queued item cannot say
  what project it belongs to or whether it is research or build. Upstream
  publishes both per backlog record, the same way it does per task, but the
  panel does not yet carry them through the document. Filling it is the
  real-fleet-source worker's change, from the snapshot inward.
- **The fleet home is read on every pass, without caching.** Each read lists one
  directory and opens a handful of small files per worker, which is cheap at
  fleet scale and bounded by the same read timeout as the snapshot. A fleet
  large enough for that to matter would want the walk bounded; nothing measures
  it today.

- **A halted worker's coarse stage is not in the document.** `Lifecycle` carries
  the stage a worker is in, not the stage it was in before it stopped. The rail
  infers it from `step` - the pipeline's steps only run inside validation - so a
  worker held or failed inside the pipeline shows where it stopped, and one
  blocked or waiting elsewhere shows no position rather than a guessed one. A
  `lastActiveStage` on `Lifecycle` would close it.

- **The brief is a pointer, not the instructions.** A card can offer the path a
  worker was dispatched with, but not what it says, so "what is this worker even
  doing" is answered by a path the operator then has to open themselves.
- **`ChecksState` is always `unknown`.** Upstream's snapshot carries a pull
  request's address but nothing about its checks. The field is in the document
  on purpose; filling it means reading the forge. See
  `docs/decisions/2026-08-30-the-document-seam.md`.
- **No accessibility pass.** Semantic elements and a `role="status"` on each
  lens's status line, in `lens-frame.tsx`, are as far as it goes. Keyboard
  traversal and contrast ratios across all four status tokens have not been
  checked.
- **The dark theme is class-only.** It has no switcher and does not follow the
  operator's system preference. See
  `docs/decisions/2026-08-30-theme-and-palette.md`.
