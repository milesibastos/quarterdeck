# The shipshape lens

2026-08-30. Landed.

## What was built

`src/ui/shipshape/` draws the three health signals from `document.health` and
nothing else, plus the lens's own deliberate dark state.

- `thresholds.ts` - `SUPERVISION_SILENT_AFTER_MS` (ten minutes), beside the
  words the copy uses for it, so the number and the label cannot drift apart.
- `signal-block.tsx` - the shared shell one signal renders inside, and the
  `Unread` block an unreadable signal uses in place of its normal body.
- `shipshape-lens.tsx` - the three signals in order, and the whole-lens dark
  state when health cannot be read at all.

Three signals - supervisor, overdue, drift - each independently `ok` or
`unreadable`, with a verdict slug of its own: supervisor is
alive/silent/stopped/unreadable, overdue is clear/overdue/unreadable, drift is
clear/disagreeing/unreadable. Each is exposed as `data-signal`/`data-read`/
`data-verdict`, so a test can pin one signal dark while the others keep their
verdicts.

One line changed outside the directory - `shell.tsx` hands the lens the same
`nowMs` the other two lenses already receive - plus the shipshape assertion in
`tests/panel.test.ts`, replacing the placeholder marker it existed to be
replaced by.

## Decision log

**Ten minutes, named once.** Supervision is a cycle, not an event, so a gap of
minutes is already a gap, while a threshold in seconds would cry wolf on a
long-running cycle. The number lives in `thresholds.ts` beside the words the
copy uses for it, so a changed threshold cannot leave the copy quoting a stale
one.

**Unread is grey and dashed, not grey alone.** The same convention
`lifecycle-rail.tsx` uses for a worker off the track - shape rather than hue
alone, so it survives both themes and a reader who cannot see colour.

**An unreadable signal names what is unknown, not just what failed.** Its
`detail` is drawn beside an explicit sentence naming what the panel therefore
does not know, because a signal that did not read has no age, no count and no
verdict word to draw instead. An unreadable signal must never render as a
healthy one, or imply what it would have said - this is the third bug of that
family found in the project.

**The whole-lens dark copy describes the separation between readers, not the
state of the others.** The component is handed `document.health` and nothing
else, so it cannot see whether fleet and deck read cleanly - a hard-coded "the
others are fine" would be a lie the day both readers fail together. What it
can say, because the document is built that way, is that they come from a
different source with a status of its own.

**No new fixture set.** `health-dark` already covers the whole-lens-dark
state. The mixed-signal document needed for a supervisor that is alive but
silent, beside an overdue signal that is unreadable, is written into a private
fixture copy inside `tests/shipshape-lens.test.ts` rather than committed - it
is one test's material, and the committed sets already cover every
combination the rest of the suite needs.

**Ages come from the shared `ago` helper**, computed on the server against the
`nowMs` the composition point chose, the same rule the deck lens follows - see
`docs/plans/done/2026-08-30-deck-lens.md`.
