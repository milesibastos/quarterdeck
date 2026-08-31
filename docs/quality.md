# Quality

A grade per area, and where the gaps are. Written to be honest rather than
flattering: an area marked green is one somebody can build on without checking.

Last reviewed: 2026-08-31, at the end of the pass that extended the document to
everything the wireframe still needs - one version bump, checked field by field
against two live fleet homes rather than against the last pass's notes.

| Area | Grade | Where it stands |
| --- | --- | --- |
| Layer boundaries | Green | All seven invariants checked in `npm test`, each with a planted violation proving the check works. Invariant 3 now confines two capabilities: writing, and starting a process. |
| The document contract | Green | Four lenses and an omissions list, a status per lens, pinned and parsed strictly. `tests/document.test.ts` walks every fixture set and asserts the document it produces - now including the landed lens's contents and every omission's reason; the refusal is tested end to end through the built server. Version 4 added everything the wireframe still needed in one bump, and each field was checked against a live fleet rather than assumed: five of them turned out to be things upstream records or publishes and the panel had not read, and two earlier "upstream does not have it" notes were simply wrong. Those are corrected in `docs/contract.md` - open assumptions, each with the command it was checked with. One assumption remains. |
| The refresh loop | Green | Coalescing, timeout, last-known-good and the signal are tested; scroll preservation demonstrated in a browser, not asserted. |
| Fixtures | Green | Fifteen sets, two files each, in the shape upstream actually publishes, plus three synthetic fleet homes under `fixtures/homes/` for the health module to read and for its tests to break. Every state the document can reach has one, including each lens dark on its own and a worker the panel cannot see; `upstream-shape` uses only the vocabulary a live fleet emits. Backlog rows come both ways - with a project and kind, and with neither, which is what a hand-written queue mostly looks like. `crowded` carries thirty workers and fifteen deck rows, which is the size the layout was tuned against; `wide-detail` carries the unbreakable status detail that used to burst a frame; `all-dark` is every lens dark at once. The six combinations of lens statuses with no set of their own are composed in `tests/degradation.test.ts` rather than committed as directories that differ by a timestamp. Version 4's fields are covered in every state they can hold: a worker with everything recorded at dispatch and one with nothing, all three delivery contracts and one nobody recognises, a brief with its text and one with only a summary, all three check outcomes plus an unreadable forge plus a forge nobody asked, a review with comments and one that was asked and found none, landed work in this home and in a mate's, a mate's home that upstream bounded and one that did not answer, and a health file that predates the two newest signals. |
| Theme | Green | Semantic tokens over a palette layer, light and dark, fonts vendored, and now actually reachable: the dark theme follows the operator's system setting rather than a class nothing ever set, in one copy of the mapping, with no script and so no flash. The `dark:` utilities the vendored shadcn components carry resolve through the same media query as the tokens, so the two cannot disagree. Switching it on was the first time anybody had seen it, and three of its tokens were below AA and were re-pointed at other stops of the same palette. The served stylesheet is asserted in `tests/shell.test.ts`; both directions were measured in a browser. See `docs/decisions/2026-08-31-the-theme-follows-the-system.md`. |
| Security baseline | Green | Host, Origin, CSP and the acting guard are tested, and the acting round trip is now driven end to end: the page carries the secret, a request without it and one with the wrong one are both refused, and a panel with no answer spool hands out no secret at all. Request identity and replay rejection are wired and tested against the spool on disk, which discharges the forward obligation in `docs/decisions/2026-08-30-security-baseline.md`. |
| `adapters/health.ts` | Green | Reads a real fleet home as well as the fixture health file, filling all five signals from files that carry no compatibility promise. Every signal has a tested unreadable path, one signal going dark leaves the others working, a health file predating a signal darkens that signal alone rather than the file, and a home that is not there darkens the lens alone - `tests/health.test.ts` breaks a copied home three ways and asserts none of it throws. The thresholds are the fleet's own defaults, which is a number to keep in step with upstream rather than a gap. |
| The write path | Amber | `Intent` is a union discriminated on `kind` with one member and a per-kind format table, so the merge order that is coming is a member and a row rather than a second writer; `answer-decision`'s bytes, extension and request-identity digest are pinned by test, because records written by earlier builds are still in spools and their names are what make a replay a collision. `intent.ts` writes one record per answered decision - one intake line, published by `link` so a replay collides rather than repeats - and executes nothing. The spool is declared per fleet (`QUARTERDECK_INTENT_DIR`, positional against the fleet list) and the route resolves which fleet's spool to use from the selection cookie, so an answer given while looking at one fleet can never land in another's. `tests/answering.test.ts` drives the single-fleet path through the built server: the record's exact bytes, eight simultaneous clicks leaving one record, a replay leaving the spool byte-identical, and every format refusal writing nothing. `tests/answering-fleet.test.ts` drives the multi-fleet path: two fleets with different spools stay apart, and a fleet with none configured refuses rather than guessing. Amber only because nothing picks the records up yet: the fleet-side process-event adapter is not built, so a recorded answer reaches the intake only once it is. See `docs/decisions/2026-08-30-answering-a-held-decision.md`. |
| The deck lens | Amber | Offers an answer control on work held for a person - both closes the intake accepts, declared on the card - and nothing on a hold that waits on a queue, a date or an upstream release. Draws all four piles - held, blocked, queued, in flight - from the document, with the empty, stale and unreadable states each saying which they are. Driven end to end through the built server, including both directions of the blocker rule. A row now names its project and whether the work is research or build, from the `repo` and `kind` upstream publishes per record, and a row that named neither says so rather than guessing. Amber only because nothing picks up the answers it records - the write path's gap, not the lens's. See `docs/plans/done/2026-08-30-deck-lens.md`. |
| The shipshape lens | Amber | Draws three of the five health signals - supervisor, overdue, drift - each in its `ok` and `unreadable` forms, plus the whole-lens dark state. A supervision cycle alive but silent for longer than the named threshold reads as a concern, not as health; an unreadable signal never implies what it would have said. `tests/shipshape-lens.test.ts` drives every state, including a mixed reading, through the built server. Amber because version 4 added `queue` and `attendance` to the document and nothing draws them yet - the wireframe's strip names five entries and the lens shows three. The fields and their fixtures are there; drawing them is a separate task. See `docs/plans/done/2026-08-30-shipshape-lens.md`. |
| The fleet lens | Amber | The worker card and the lifecycle rail. Every coarse stage and every off-track state has a tone and a place on the rail, the validation step is named with its place in the run, and a halted worker shows the stage it left the track in and upstream's words for why. A worker the panel cannot see is drawn as unseen, with an unlit rail: no position is inferred for it, not even from the step words upstream's own account of its blindness happens to contain. Stale, empty and unreadable are three different states on screen. `tests/fleet-lens.test.ts` drives all of it through the built server; refresh in place was demonstrated in a browser. Amber because version 4 put six things on the card's document that the card does not draw: where the work physically is, the spec's own words, the delivery contract that says which rail the worker even has, the checks outcome and its progress, and whether a person has commented. The rail is still one fixed track. The fields and their fixtures are there; drawing them is a separate task. |
| The shell | Green | Three equal columns; at `md` and up the page is exactly one viewport tall and each lens scrolls inside itself under a pinned header carrying its name, its trust word and how much it is holding. A fleet of two and a fleet of thirty put the same three answers on screen, and the difference shows up as a scrollbar rather than as the shipshape lens leaving the page. Measured against the `crowded` set in a browser at 1440x900 and at 360 CSS pixels: the page never scrolls sideways, and no element's right edge passes the client width. `tests/shell.test.ts` drives the pinned headers, the counts and the scroll regions through the built server. See `docs/decisions/2026-08-31-the-fold-line.md`. |
| Degraded states | Green | All fifteen combinations of the three lens statuses that the projection can actually reach - fleet and deck share the snapshot's `generated`, health is read separately - are driven through the built server one page at a time in `tests/degradation.test.ts`, which asserts that all three lenses stay framed in every one of them. The one the project designed for deliberately, shipshape dark beside a fresh fleet and deck, has both a committed fixture set and a test. |
| Accessibility | Amber | Headings form an outline with no level skipped, one `h1` per page, one `h2` per lens, and it is checked in `tests/shell.test.ts`. Each lens header is a `role="status"` region containing its own name, so a lens turning stale under a reader is announced and the announcement says which lens moved; the answer control's outcome is a `status` and its refusal an `alert`. Every scrolling lens body takes keyboard focus and is named by its heading. Contrast was measured rather than assumed - see the gap below for the two values in the light theme that are still short. |
| Choosing a fleet | Green | The panel offers every configured fleet, the operator switches between them and their browser remembers the choice, and no writer was needed for it. `tests/fleet-switch.test.ts` drives it through the built server: the content follows the selection, two fleets read at once are never mixed up, an unreadable one degrades through the per-lens statuses with the picker still there to leave by, and a single-fleet panel still names what it is showing. The mid-switch state - the previous fleet named, the incoming one named, nothing attributed to the wrong one - was checked in a browser under throttling. |
| Reading a real fleet | Amber | Wired: a configured fleet home, its snapshot command run through the one spawn door, parsed strictly and projected into the fleet and deck parts. Tested two ways with no fleet present - the parsing, refusals and read discipline against a stub runner, and the whole path end to end through the built server against a temporary fleet home holding one script. Both of upstream's homeless values now have one: `unknown` is the `unseen` stage and a record with no start date carries none. Amber only because the fleet home is read on every pass with no caching, which is the gap below. |

## Known gaps

- **The landed lens and the omissions list have no reader.** Version 4 put both
  in the document with fixtures covering every state, and no component draws
  either. That is deliberate - the shape was frozen alone, before seven features
  were built against it - but until a lens draws them, landed work and the
  disclosure bar are carried and not shown.
- **Nothing reads the answer spool yet.** The panel writes a record in exactly
  the shape `bin/fm-captain-hold.sh answers` reads, and the fleet side that
  picks it up - a process-event adapter with an `answers` command, bound before
  it is armed - does not exist. Until it does, an answer is recorded and goes no
  further. The panel's copy is honest about the recording and claims nothing
  about the fleet having acted, but an operator with no adapter armed will see
  nothing happen. The record format in
  `docs/decisions/2026-08-30-answering-a-held-decision.md` is the contract that
  adapter gets built against.
- **The since-as-empty-string request id is undriven by a test.** No fixture has
  an actionable, captain-held item with no start date, so the path where an
  absent `since` travels as the empty string in the answer record's digest -
  see `docs/decisions/2026-08-31-what-the-document-may-not-say.md` - is
  documented but not exercised. Closing it means adding such a row to a fixture
  that several suites already assert counts against.
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

- **Five things the wireframe wants that a live snapshot does not publish.** All
  five now have a field with an honest absent form, and all five are `null` or
  `not-looked-up` on every real read. Checked on 2026-08-31 against
  `bin/fm-fleet-snapshot.sh --json` in two live fleet homes, not from memory:

  | What | What is actually true | Evidence |
  | --- | --- | --- |
  | `dispatch.branch` | Not recorded anywhere - not in the snapshot, and not in the home's own dispatch record either. | `state/<id>.meta` holds `window`, `worktree`, `project`, `harness`, `kind`, `mode`, `yolo`, `model`, `effort` and the two generation tokens, and no branch. |
  | `dispatch.model`, `dispatch.effort` | **Recorded at dispatch, and not published.** This is the distinction that matters: the fleet writes `model=opus` and `effort=high` into `state/<id>.meta` when it dispatches a worker, and the snapshot command simply does not carry them out. | The meta file above. `grep -nE 'model\|effort\|branch' bin/fm-fleet-snapshot.sh` matches nothing, and no such key appears anywhere in a live `--json`. |
  | `brief.summary`, `brief.text` | Not published, and the path upstream does publish is not the brief. `paths.meta` points at `state/<id>.meta`, the key-value dispatch record; the brief is scaffolded at `data/<id>/brief.md`. | `grep -n brief bin/fm-fleet-snapshot.sh` matches nothing. `bin/fm-brief.sh` line 174 writes `$DATA/$ID/brief.md`. A live task's `paths.meta.path` ends `.meta`. |
  | `pullRequest.checks`, `pullRequest.review` | Not carried. `pr` is `{ url, source }` and `source` is one of `meta`, `status_event`, `absent`. | Both live homes; `bin/fm-fleet-snapshot.sh` lines 480-487 and 630. |

  Reading the meta record from the fleet lens is not the fix. Those paths are
  fleet-internal and only the quarantined health module may name them, and
  wiring the fleet lens through it would put the panel's most stable reader
  behind its least stable one. The fix upstream is four keys in the snapshot;
  until then the parser accepts all of them optionally, so a finer upstream
  fills them without a parser change, and the fixture fleets are what exercise
  the filled shape.

  The forge readings are different in kind: nothing is missing upstream, the
  read simply has not been built. It is a network call, deliberately opt-in and
  off the first paint, and the document says `not-looked-up` and names it in
  `omissions` rather than pretending to a green light.

- **A held lock is not a live lock.** `attendance.locked` is whether the lock
  file is present. `bin/fm-lock.sh status` distinguishes further - free, held by
  a live harness pid, or stale - by walking a process ancestry against the
  fleet's own rules for what counts as a harness. Reimplementing that is exactly
  what the quarantine exists to refuse, so a lock held by a dead session reads
  as locked here. An upstream that published the verdict would close it.
- **Two light-theme tokens are below AA as text.** Measured in the built panel
  against `--card`: `--warn` is 3.61:1 and `--info` is 4.37:1, where AA wants
  4.5:1 for text this size. Both predate this pass and neither is used to carry
  meaning on its own - the words say it and the edges are dashed as well as
  tinted - but `text-warn` on the fleet picker's switching note and `text-info`
  on a pull request link are both text somebody has to read. The palette has no
  darker gold, so closing the first means either a new palette stop or moving
  the token to another hue, and the palette is not this pass's to redesign. The
  dark theme's remaining shortfall is `--primary` as chip text at 4.38:1; it
  cannot step to `rust-300` without becoming `--danger`. Everything else
  measured in either theme is at or above 4.5:1.
- **A column that scrolls says so only by being cut off.** macOS overlay
  scrollbars are invisible until used, so what tells an operator there are more
  than twelve workers is the count in the pinned header and a card visibly
  clipped at the bottom edge. Both are real cues; neither is loud. Nothing
  enforces a minimum viewport height either, so a short window squeezes all
  three columns together.
- **A panel with no answer spool repeats itself.** Every held row that waits on
  a person and has nowhere to send an answer draws the same sentence saying so,
  which on the `crowded` set is four copies of it down one column. The sentence
  is right on any one row; four of them is the lens saying a configuration fact
  once per item.
- **Nothing checks contrast on every change.** The ratios above were measured
  once, in a browser, against the built panel. A token re-pointed tomorrow would
  not fail anything.
- **A fleet's own name is its last path segment.** Two fleet homes with the
  same last segment are told apart by an index suffix on the handle, not by
  anything an operator would recognise, so a panel configured with
  `.../one/fleet` and `.../two/fleet` draws two chips both reading `fleet`. A
  fleet home that named itself would fix it, which is upstream's to offer.
- **A remembered selection is per browser, not per operator.** Clearing site
  data forgets it, and a browser with cookies blocked always opens on the first
  configured fleet. Both degrade to the default rather than to an error; see
  `docs/decisions/2026-08-30-choosing-a-fleet.md`.
- **There is no theme switcher.** The operator's system setting is the only
  input, so somebody who wants the panel light on a dark desktop cannot have it.
  Adding one means a second per-viewer preference, and this project has settled
  the shape of those once already - see
  `docs/decisions/2026-08-30-choosing-a-fleet.md`. Not a defect; a thing the
  panel deliberately does not offer. See
  `docs/decisions/2026-08-31-the-theme-follows-the-system.md`.
