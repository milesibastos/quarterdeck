# The worker's terminal, on demand

2026-08-31

Twenty-one prior attempts at fleet visibility were surveyed before this project
started, and not one of them let the operator see what a worker was actually
saying. The wireframe names this as the feature that distinguishes quarterdeck
from all of them. It is also the feature most likely to be built carelessly,
because the tempting implementation - a live stream per worker - is exactly what
the snapshot ruling forbids.

Four questions had to be settled: where a tail lives, where it comes from, what
it costs, and what happens when there is nothing to read.

## It is not on the document

`src/types/terminal.ts`, not `src/types/document.ts`, and that is the whole cost
argument in one decision.

The document is what the first paint is assembled from. Every field on it is
read on every pass, for every worker, whether or not anybody is looking - which
is right for a lifecycle stage and wrong for a pane capture. A `tail` on
`Worker` would mean starting a process per worker per refresh to fill eleven
cards nobody expanded, and no amount of care downstream could undo that: the
field would exist, so the projection would have to fill it.

So the terminal is a second shape, read by a second route, asked for only when a
card is opened. `src/ui/` may still only import from `src/types/`, which is why
the shape lives in that layer rather than in the adapter that produces it.

A collapsed card is therefore one `<details>` element and no read at all.
`tests/terminal.test.ts` holds that claim the only way it can be held: the fleet
home in that file publishes a peek command that appends to a witness file before
answering, and the first paint is asserted to leave that file absent.

## It comes from the fleet's own peek command

A worker's session is a live pane. It is not a file, so it cannot be read like
one, and there is no version of this feature that does not start a process.

The panel already starts one: `bin/fm-fleet-snapshot.sh`, through the single
spawn door in `src/providers/process.ts`. The terminal read is the same class of
thing - `bin/fm-peek.sh`, relative to the same configured home, read-only by
upstream's own contract, run through the same door, which opens no shell, offers
no stdin, changes no directory and hands back standard output. Nothing new is
permitted: the panel may run read-only commands a fleet publishes about itself,
and this is a second one.

What was considered and rejected:

- **Reading the session target out of `state/<id>.meta` and capturing it
  directly.** That is a fleet-internal path, so it would have to be read by the
  quarantined health module (invariant 4) - putting the fleet lens's newest
  reader behind the panel's least stable one - and it would mean the panel
  reimplementing upstream's backend resolution, which now has five backends. The
  peek command already does all of it and is the supported surface.
- **Asking upstream to publish tails in the snapshot.** That is the live-stream
  cost the ruling forbids, moved upstream. A tail nobody asked for should not be
  computed at all.

The argument that the panel is still a reader is unchanged and still structural
rather than careful: invariant 3 bans `child_process` everywhere in `src/`
except the one spawn door, bans every write API outside
`src/adapters/intent.ts`, and bans writing inside the spawn door too. No marker
moved for this feature, and `npm test` would fail if one had.

## Which sessions it will read

Two gates, and the first is the one that matters.

Upstream's peek resolves any selector containing a colon as a raw session
target - the escape hatch for a window outside the home - so an unchecked
identifier would let the panel read any window on the machine. The route
therefore reads a session only for a work item the current document actually
lists, and the adapter independently refuses anything that is not
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` before a command is started. Two checks
because the second holds even if a later caller forgets the first, and no
command is started for a refusal - which the witness file is asserted on.

## A fourth adapter

`src/adapters/` was three files, one per reliability promise. It is now four,
because there is a third promise. `contract.ts` refuses when the shape moves;
`health.ts` degrades when a path moves; `terminal.ts` degrades *per worker*, and
is only asked when somebody opens a card. Folding it into either of the others
would have put an on-demand read inside a module the first paint waits on.

## Three absences, three sentences

A session that is gone, one that could not be read, and one that has simply said
nothing yet are three different facts about a worker, and a panel that draws all
three as an empty box has invented a fourth thing that is true of none of them.
`TerminalReading` has an arm for each, plus `ok`, and the fixture set carries a
worker in every one of them.

`ok` can never carry an empty list. A pane capture routinely ends in blank rows,
so the reading is normalised - trailing blanks dropped - before it is decided,
and a tail that is nothing but blank rows becomes `silent`. That is the same
distinction `health.json` draws between a queue read and found empty and a queue
that could not be read, and it is drawn here for the same reason.

Both sources go through one normaliser, so a committed fixture and a real fleet
cannot disagree about what fifteen noisy lines look like. Fixture `ok` entries
carry raw captured text - escape sequences, carriage returns, tabs and all -
rather than pre-cleaned lines, which is what keeps that claim honest.

## What the normaliser does, and why

The panel is not a terminal emulator and must not pretend to be one.

- A carriage return means the rest of the line was drawn over what came before
  it, so only what follows the last one is shown. Every progress bar in the
  world depends on this.
- Escape sequences - colour, cursor moves, window titles - are removed rather
  than rendered as glyphs.
- Remaining control characters are dropped. Tab survives: it is layout a worker
  meant.
- A line past two thousand characters is cut and says so.
- Ligatures are off in the box. The vendored mono face draws `==>` as one arrow
  glyph, which is charming in source and a lie about a capture.

Long lines do not wrap. A pane's lines mean what they mean at their own width,
and a table of check results re-wrapped into a paragraph is unreadable. The box
scrolls sideways inside itself; the page never does, which was measured in a
browser at 1440 and at 360 CSS pixels.

## It stays open, and still where the reader left it

The refresh ruling is that updates never move the page under the reader, and an
open terminal is the hardest case of it. Two things hold it:

- The disclosure is native and React never sets `open`. The browser owns whether
  it is expanded, and a re-render reconciles the element rather than rebuilding
  it. Same mechanism the brief disclosure above it already used.
- The lines live in the client island's state, not in the server markup. A
  `router.refresh()` re-renders the tree around it and leaves the state alone,
  so nothing is refetched, the content does not change, the scrolling element is
  not replaced, and the scroll position is exactly where it was.

The consequence, and it is deliberate: **a refresh does not bring newer lines.**
The tail is what the session said when the operator asked, dated on screen, with
a control to ask again. Lines arriving under a reader mid-sentence would be the
"never move the page" ruling broken by a feature that meant well.

Demonstrated in a browser rather than asserted here, for the reason
`docs/ARCHITECTURE.md` already gives for the other three claims of this kind: an
update was landed under two open terminals - the deck grew a row, with no page
reload - and both were still open, with both scroll offsets unchanged. The half
a test can hold is in `tests/terminal.test.ts`: after an update lands, the
witness file shows the session was never read again.
