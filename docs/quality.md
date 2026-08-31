# Quality

A grade per area, and where the gaps are. Written to be honest rather than
flattering: an area marked green is one somebody can build on without checking.

Last reviewed: 2026-08-31, at the end of the pass that finished the worker card
- where the work physically is, the instructions in the card, and the pull
request block - and built the forge read those last two fields needed. It
landed on top of the worker terminal - the first feature deliberately built
beside the document rather than on it - which itself landed on top of the pass
that drew the shipshape strip's last two signals. That pass extended the
document to everything the wireframe still needs, one version bump, checked
field by field against two live fleet homes.

| Area | Grade | Where it stands |
| --- | --- | --- |
| Layer boundaries | Green | All seven invariants checked in `npm test`, each with a planted violation proving the check works. Invariant 3 now confines two capabilities: writing, and starting a process. |
| The document contract | Green | Four lenses and an omissions list, a status per lens, pinned and parsed strictly. `tests/document.test.ts` walks every fixture set and asserts the document it produces - now including the landed lens's contents and every omission's reason; the refusal is tested end to end through the built server. Version 4 added everything the wireframe still needed in one bump, and each field was checked against a live fleet rather than assumed: five of them turned out to be things upstream records or publishes and the panel had not read, and two earlier "upstream does not have it" notes were simply wrong. Those are corrected in `docs/contract.md` - open assumptions, each with the command it was checked with. One assumption remains. |
| The refresh loop | Green | Coalescing, timeout, last-known-good and the signal are tested; scroll preservation demonstrated in a browser, not asserted. |
| Fixtures | Green | Fifteen sets, two files each and one with a third, in the shape upstream actually publishes, plus four synthetic fleet homes under `fixtures/homes/` for the health module to read and for its tests to break. Every state the document can reach has one, including each lens dark on its own and a worker the panel cannot see; `upstream-shape` uses only the vocabulary a live fleet emits. Backlog rows come both ways - with a project and kind, and with neither, which is what a hand-written queue mostly looks like. `crowded` carries thirty workers and fifteen deck rows, which is the size the layout was tuned against; `wide-detail` carries the unbreakable status detail that used to burst a frame; `all-dark` is every lens dark at once. The six combinations of lens statuses with no set of their own are composed in `tests/degradation.test.ts` rather than committed as directories that differ by a timestamp. Version 4's fields are covered in every state they can hold: a worker with everything recorded at dispatch and one with nothing, all three delivery contracts and one nobody recognises, a brief with its text and one with only a summary, all three check outcomes plus an unreadable forge plus a forge nobody asked, a review with comments and one that was asked and found none, landed work in this home and in a mate's, a mate's home that upstream bounded and one that did not answer, and a health file that predates the two newest signals. |
| Theme | Green | Semantic tokens over a palette layer, light and dark, fonts vendored, and now actually reachable: the dark theme follows the operator's system setting rather than a class nothing ever set, in one copy of the mapping, with no script and so no flash. The `dark:` utilities the vendored shadcn components carry resolve through the same media query as the tokens, so the two cannot disagree. Switching it on was the first time anybody had seen it, and three of its tokens were below AA and were re-pointed at other stops of the same palette. The served stylesheet is asserted in `tests/shell.test.ts`; both directions were measured in a browser. See `docs/decisions/2026-08-31-the-theme-follows-the-system.md`. |
| Security baseline | Green | Host, Origin, CSP and the acting guard are tested, and the acting round trip is now driven end to end: the page carries the secret, a request without it and one with the wrong one are both refused, and a panel with no answer spool hands out no secret at all. Request identity and replay rejection are wired and tested against the spool on disk, which discharges the forward obligation in `docs/decisions/2026-08-30-security-baseline.md`. |
| `adapters/health.ts` | Green | Reads a real fleet home as well as the fixture health file, filling all five signals from files that carry no compatibility promise. Every signal has a tested unreadable path, one signal going dark leaves the others working, a health file predating a signal darkens that signal alone rather than the file, and a home that is not there darkens the lens alone - `tests/health.test.ts` breaks a copied home four ways - including a queue file that exists and will not open, which darkens the queue alone - and asserts none of it throws. The thresholds are the fleet's own defaults, which is a number to keep in step with upstream rather than a gap. |
| The write path | Amber | `Intent` is a union discriminated on `kind` with one member and a per-kind format table, so the merge order that is coming is a member and a row rather than a second writer; `answer-decision`'s bytes, extension and request-identity digest are pinned by test, because records written by earlier builds are still in spools and their names are what make a replay a collision. `intent.ts` writes one record per answered decision - one intake line, published by `link` so a replay collides rather than repeats - and executes nothing. The spool is declared per fleet (`QUARTERDECK_INTENT_DIR`, positional against the fleet list) and the route resolves which fleet's spool to use from the selection cookie, so an answer given while looking at one fleet can never land in another's. `tests/answering.test.ts` drives the single-fleet path through the built server: the record's exact bytes, eight simultaneous clicks leaving one record, a replay leaving the spool byte-identical, and every format refusal writing nothing. `tests/answering-fleet.test.ts` drives the multi-fleet path: two fleets with different spools stay apart, and a fleet with none configured refuses rather than guessing. Amber only because nothing picks the records up yet: the fleet-side process-event adapter is not built, so a recorded answer reaches the intake only once it is. See `docs/decisions/2026-08-30-answering-a-held-decision.md`. |
| The deck lens | Amber | Offers an answer control on work held for a person - both closes the intake accepts, declared on the card - and nothing on a hold that waits on a queue, a date or an upstream release. Draws all four piles - held, blocked, queued, in flight - from the document, with the empty, stale and unreadable states each saying which they are. Driven end to end through the built server, including both directions of the blocker rule. A row now names its project and whether the work is research or build, from the `repo` and `kind` upstream publishes per record, and a row that named neither says so rather than guessing. Amber only because nothing picks up the answers it records - the write path's gap, not the lens's. See `docs/plans/done/2026-08-30-deck-lens.md`. |
| The shipshape lens | Green | Draws all five health signals - supervisor, queue, attendance, overdue, drift - each in its `ok` and `unreadable` forms, plus the whole-lens dark state. A supervision cycle alive but silent for longer than the named threshold reads as a concern, not as health; a queue holding the threshold or more reads as one that has stopped draining, and the boundary is pinned by test; away mode and the home lock are drawn as the two entries the wireframe asks for, under the one verdict the document can honestly give both. An unreadable signal never implies what it would have said, and a document with exactly one dark signal draws exactly one dark block with the other four verdicts intact. `tests/shipshape-lens.test.ts` drives every state through the built server, including a mixed reading, a health file predating two of the signals, and each new signal dark on its own. See `docs/plans/done/2026-08-31-the-last-two-health-signals.md`. |
| The fleet lens | Amber | The worker card and the lifecycle rail. Every coarse stage and every off-track state has a tone and a place on the rail, the validation step is named with its place in the run, and a halted worker shows the stage it left the track in and upstream's words for why. A worker the panel cannot see is drawn as unseen, with an unlit rail: no position is inferred for it, not even from the step words upstream's own account of its blindness happens to contain. Stale, empty and unreadable are three different states on screen. The card now also says where the work physically is - the worktree, the branch, the runtime, the model and the effort, each either its recorded value or an explicit "not recorded" - carries the dispatch instructions summarised with their full text one click behind, and draws a pull request block, only where there is a pull request, with the whole address, how far its checks have got and whether a person has commented. `not-looked-up` and a forge that answered never render alike, in either signal. `tests/fleet-lens.test.ts` drives all of it through the built server, against the `healthy` set that carries every field in every state it can hold; light, dark and 360 CSS pixels were measured in a browser. Amber because the rail is still one fixed track and does not yet read `delivery`, which is the last of version 4's fields with no reader - a sibling task. |
| The worker terminal | Green | Last fifteen lines, read only, expanded in the card, and read only when it is opened - which `tests/terminal.test.ts` asserts rather than assumes, against a fleet home whose peek command records every call it receives: the first paint leaves that record empty. Four readings, and the three absences stay three sentences on screen - a session that is gone, one that could not be read, one that answered with nothing. Both sources normalise through one pipeline, so escapes, redrawn lines, tabs and a two-thousand-character line behave the same from a fixture and from a fleet. A worker not in the current document, and any id upstream's peek would resolve as a raw session target, are refused with no command started; every method but `GET` is refused too. That an open terminal survives an update with both scroll offsets intact was demonstrated in a browser, as was a long line scrolling inside its box at 1440 and 360 CSS pixels; the half a test can hold - that the server never re-reads a session on a refresh - is in the suite. See `docs/decisions/2026-08-31-the-worker-terminal.md`. |
| The shell | Green | Four bands, stacked, in one order at every width. What needs the operator personally owns the first screen - 62% of it at 1440x900, sized by rule so an under-filled band shows the room it is not using - and underway peeks below it. No centred maximum width and no fixed column count: one `card-grid` utility turns width into more cards at the size they were designed at, drawing 2 columns at 1024 and 6 at 2560. The age badge carries the trust signal above the fold, with the rebuild command in it. Measured in a browser across four viewports in both themes: nothing overflows sideways, and a refresh under an open disclosure moves neither the scroll nor the disclosure. `tests/shell.test.ts`, `tests/needs-you.test.ts`, `tests/width.test.ts` and `tests/snapshot-age.test.ts` drive the rest through the built server. See `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`. |
| Degraded states | Green | All fifteen combinations of the three lens statuses that the projection can actually reach - fleet and deck share the snapshot's `generated`, health is read separately - are driven through the built server one page at a time in `tests/degradation.test.ts`, which asserts that all three lenses stay framed in every one of them. The one the project designed for deliberately, shipshape dark beside a fresh fleet and deck, has both a committed fixture set and a test. |
| Accessibility | Amber | Headings form an outline with no level skipped, one `h1` per page, one `h2` per lens, and it is checked in `tests/shell.test.ts`. Each lens header is a `role="status"` region containing its own name, so a lens turning stale under a reader is announced and the announcement says which lens moved; the answer control's outcome is a `status` and its refusal an `alert`. Each band body is named by its own heading; none of them scrolls inside itself any more, so none carries `tabindex="0"` - a trade-off recorded in `docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md`. Contrast was measured rather than assumed - see the gap below for the two values in the light theme that are still short. |
| Choosing a fleet | Green | The panel offers every configured fleet, the operator switches between them and their browser remembers the choice, and no writer was needed for it. `tests/fleet-switch.test.ts` drives it through the built server: the content follows the selection, two fleets read at once are never mixed up, an unreadable one degrades through the per-lens statuses with the picker still there to leave by, and a single-fleet panel still names what it is showing. The mid-switch state - the previous fleet named, the incoming one named, nothing attributed to the wrong one - was checked in a browser under throttling. |
| Reading the forge | Amber | A pull request's checks and its review comments, read through `gh api graphql` on the one spawn door, opt-in behind `QUARTERDECK_READ_FORGE`, off the first paint, and floored at one read a minute per pull request - the floor stamped at schedule time, so a burst of renders is one read and a refusing forge is not retried on every render. Every failure degrades to an `unreadable` reading carrying the line it failed with, and none of them can throw. `tests/forge.test.ts` proves the cost rule against a stub runner and a clock it moves by hand, including that a failed read is rate-limited exactly like a successful one; `tests/fleet-lens.test.ts` proves the same end to end against a `gh` on the panel's own `PATH` that is a shell script - nothing asked before the operator opts in, three calls for three pull requests, and ten more renders inside the minute adding none. Amber for the two bounds in the gaps below: one undercounts a review's comments, the other reports a checks count as `unreadable` rather than guess at it. See `docs/decisions/2026-08-31-reading-the-forge.md`. |
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

- **A terminal tail does not follow the fleet.** The lines are what the session
  said when the operator asked, dated on screen, with a control to ask again.
  That is deliberate - lines arriving under a reader mid-sentence is the "never
  move the page" ruling broken by a feature that meant well - but it does mean a
  terminal left open for ten minutes is showing a ten-minute-old tail, and the
  only thing saying so is the timestamp beside it.
- **Which of upstream's failures is a missing session is matched on its prose.**
  `terminal.ts` reads "no metadata for", "no backend target recorded" and "no
  window named" out of the peek's standard error to tell a session that is gone
  from a read that broke. A phrasing this build does not recognise falls through
  to `unreadable`, which is honest rather than wrong, but it is a soft
  dependency on wording upstream has not promised. An exit code per outcome
  would close it, which is upstream's to offer.
- **One fixture set has a `terminal.json`.** `healthy` carries all four
  readings; every other set records no sessions, so its cards all say so. That
  is a true statement about a synthetic fleet rather than a defect, but it does
  mean the crowded layout has never been looked at with thirty tails in it.
- **A review with only inline comments is not counted as a comment.** The count
  is issue comments left by a person plus reviews left by a person that carry a
  body. A review submitted with nothing but inline code comments carries no body
  and is missed, which understates by one on a pull request somebody has already
  engaged with. Counting bodiless approvals instead would overstate in the other
  direction - "approved without a word" is not a comment - so the bound was
  chosen deliberately. Closing it means a `reviewThreads` page in the query.
- **A run whose checks cannot all be listed reports as unreadable, not
  approximated.** `finished` is counted from the individual checks, never from
  the rollup verdict: the verdict can reach `FAILURE` while other checks are
  still running, and treating that as "every check reported" would overstate
  progress rather than understate it. When the forge reports more checks exist
  than the page it listed (`contexts(first: 100)`), there is no way to tell how
  many of the unlisted ones have finished, so the reading is `unreadable`
  rather than a guessed count.

- **A halted worker's coarse stage is not in the document.** `Lifecycle` carries
  the stage a worker is in, not the stage it was in before it stopped. The rail
  infers it from `step` - the pipeline's steps only run inside validation - so a
  worker held or failed inside the pipeline shows where it stopped, and one
  blocked or waiting elsewhere shows no position rather than a guessed one. A
  `lastActiveStage` on `Lifecycle` would close it.

- **Five things the wireframe wants that a live snapshot does not publish.** All
  five have a field with an honest absent form, and the first four are `null` on
  every real read. The fifth - the forge readings - is now filled by the panel
  itself when the operator asks for it, and reads `not-looked-up` when they have
  not. Checked on 2026-08-31 against `bin/fm-fleet-snapshot.sh --json` in two
  live fleet homes, not from memory:

  | What | What is actually true | Evidence |
  | --- | --- | --- |
  | `dispatch.branch` | Not recorded anywhere - not in the snapshot, and not in the home's own dispatch record either. | `state/<id>.meta` holds `window`, `worktree`, `project`, `harness`, `kind`, `mode`, `yolo`, `model`, `effort` and the two generation tokens, and no branch. |
  | `dispatch.model`, `dispatch.effort` | **Recorded at dispatch, and not published.** This is the distinction that matters: the fleet writes `model=opus` and `effort=high` into `state/<id>.meta` when it dispatches a worker, and the snapshot command simply does not carry them out. | The meta file above. `grep -nE 'model\|effort\|branch' bin/fm-fleet-snapshot.sh` matches nothing, and no such key appears anywhere in a live `--json`. |
  | `brief.summary`, `brief.text` | Not published, and the path upstream does publish is not the brief. `paths.meta` points at `state/<id>.meta`, the key-value dispatch record; the brief is scaffolded at `data/<id>/brief.md`. | `grep -n brief bin/fm-fleet-snapshot.sh` matches nothing. `bin/fm-brief.sh` line 174 writes `$DATA/$ID/brief.md`. A live task's `paths.meta.path` ends `.meta`. |
  | `pullRequest.checks`, `pullRequest.review` | Not carried. `pr` is `{ url, source }` and `source` is one of `meta`, `status_event`, `absent`. Closed on this side rather than upstream's: the panel reads the forge itself, opt-in, and fills only what upstream left out - so the day a fleet publishes these, its answer wins and the panel stops asking. | Both live homes; `bin/fm-fleet-snapshot.sh` lines 480-487 and 630. |

  Reading the meta record from the fleet lens is not the fix. Those paths are
  fleet-internal and only the quarantined health module may name them, and
  wiring the fleet lens through it would put the panel's most stable reader
  behind its least stable one. The fix upstream is four keys in the snapshot;
  until then the parser accepts all of them optionally, so a finer upstream
  fills them without a parser change, and the fixture fleets are what exercise
  the filled shape.

  The forge readings are different in kind, and are no longer in this list: the
  read is built. `src/adapters/forge.ts` asks `gh` about a pull request when the
  operator sets `QUARTERDECK_READ_FORGE`, and with it unset every pull request
  still reads `not-looked-up` and is still named in `omissions`. See the forge
  row above and `docs/decisions/2026-08-31-reading-the-forge.md`.

- **Three health signals share one source, so they go dark together.**
  `attendance`, `overdue` and `drift` all need a listing of the fleet home's
  `state/` directory - away mode and the lock are marker files in it, and the
  other two need the set of workers the fleet has out. Whatever hides one hides
  all three, so a state directory that has moved darkens three signals rather
  than one, and there is no way to break attendance alone at the source.
  `supervisor` reads a file inside the same directory and goes with them;
  `queue` is the one signal of the five that can also fail on its own, and
  `tests/health.test.ts` breaks it that way.

  Deliberate, and it errs the safe way: three signals saying they could not be
  read is less confidence than the panel has, never more, which is the opposite
  of the defect this project keeps catching. But it is worth knowing before
  reading a dark strip as three independent failures, and worth knowing before
  writing a test that expects one. The lens itself never amplifies - a document
  with one dark signal draws exactly one dark block - and
  `tests/shipshape-lens.test.ts` pins that separately for each new signal. See
  `docs/plans/done/2026-08-31-the-last-two-health-signals.md`.

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
- **Shipshape is below the fold.** The layout that put it on the first screen
  weighted the three lenses equally, which the wireframe rules out. What carries
  the trust signal above the fold now is the age badge - a supervision cycle
  that has stopped is a snapshot that stops being refreshed - and that is
  weaker: a cycle alive but drifting is invisible until the operator scrolls.
  The wireframe's answer is a thin shipshape strip in the masthead, which is
  lens-internal work nobody has done.
- **Nothing enforces a minimum viewport height.** A short window squeezes every
  band, and the needs-you band has been told to take 62% of whatever it is
  given.
- **A panel with no answer spool repeats itself.** Every held row that waits on
  a person and has nowhere to send an answer draws the same sentence saying so,
  which on the `crowded` set is four copies of it across the needs-you band. The sentence
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
