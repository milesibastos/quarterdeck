# Fixture fleets

Every fleet in here is invented. The project names, work item ids and paths do
not correspond to anything real, and never may: this repository is public and
the tool it holds reads a private fleet. Test material has been synthetic since
the first commit so that nobody ever has to decide, later and in a hurry,
whether a particular sample is safe to publish.

`npm test` asserts this: a leak guard greps every tracked file, plus every
uncommitted file that is not gitignored, for home directories, absolute
machine paths and real operator identifiers.

Which sets the panel can read is a config value, not a code change:

```sh
QUARTERDECK_FIXTURE_SET=stale npm start                    # one
QUARTERDECK_FIXTURE_SET=healthy:stale:deck-dark npm start  # three to switch between
```

Each set in the list is one fleet the panel offers, in the order written. Which
of them is on screen is the operator's, not the setting's: they pick it in the
panel and their browser remembers it. See
docs/decisions/2026-08-30-choosing-a-fleet.md.

Whether it reads fixture sets at all is a config value too. Set
`QUARTERDECK_FLEET_HOME` to one or more absolute fleet homes and the panel runs
those homes' snapshot commands instead; leave it unset - which is every test
run, and development on a machine with no fleet - and it reads the sets above.

## Up to three files per set

The panel has three readers, with three different promises, so a set has up to
three files.

- `snapshot.json` - the upstream contract, carrying the fleet and the deck. It
  parses or it refuses; the schema identifier is pinned.
- `health.json` - the panel's own shape, read by the quarantined module. It may
  be absent, malformed or partly unreadable, and the module degrades rather than
  throwing.
- `terminal.json` - the panel's own shape again, read only when an operator
  expands a worker card. Optional: a set without one is a synthetic fleet that
  records no sessions, and every card in it says so rather than failing.

That is why a set can be dark in one lens and current in the others, and every
combination below has somewhere to live.

### `terminal.json`

One entry per work item id, in the reading's own shape - the same arrangement
`health.json` uses, and for the same reason: there is no upstream contract for a
pane capture, so a synthetic fleet has to be able to state the failures as well
as the text.

```json
{
  "wi-tidewater-114": { "read": "ok", "text": "raw capture, escapes and all" },
  "wi-saltmarsh-302": { "read": "unreadable", "detail": "..." },
  "wi-saltmarsh-305": { "read": "no-session", "detail": "..." }
}
```

An id the file does not name reads as `no-session`, which is what a fleet whose
worker has no window looks like. An `ok` entry carries **raw** captured text -
escape sequences, carriage returns, tabs, over-long lines - rather than clean
lines, so a fixture goes through exactly the normalising a real capture does;
one that normalises to nothing reads as `silent`. See
`docs/decisions/2026-08-31-the-worker-terminal.md`.

| Set | What it exercises |
| --- | --- |
| `healthy` | A worker in every coarse stage, on-track and off, plus both validating shapes - a detail that names a pipeline step and one that names none. A deck with something queued, something blocked by another item, something held for a person with a reason and a deferral date, another held for a person with no deferral so it can be answered outright, one held for something that is not a person and so cannot be answered at all, and one done record the projection drops. Its rows name a project and a kind - research, build, and a kind nobody recognised - except one that names neither and carries no start date. Health signals good, with a queue read empty and the home held with nobody away. Also the richest set for what was recorded at dispatch: a worker with a branch, runtime, model and effort and one with none of them, a third with only a branch, all three delivery contracts plus one nobody recognises plus a scout that has none, a brief carrying its summary and full text and another carrying only a summary. Its four pull requests carry a forge that was read - pending, failing, passing-and-landed, and passing-and-still-open - with a review that found one comment, two that found none, and one that could not be read. The last of the four is the only merge-ready worker in any set: open, green, and unmerged, which is the one shape the needs-you band offers a merge card on. See docs/decisions/2026-08-31-ordering-a-merge.md. Its landed lens carries this home's own merged work beside three things second mates landed in theirs, one with no address and no date and one whose home upstream did not name; its omissions name a bounded home, a home that did not answer, and one upstream does not fully trust. The one set with a `terminal.json`, carrying all four readings a card can draw: a plain tail, one full of escapes and a redrawn progress line and a line far wider than the column, a scrollback longer than fifteen lines, a session that answered with nothing, one that could not be read, one recorded as gone, and several workers it names no session for at all. |
| `empty` | A clean read of all three lenses that reports nothing running and nothing queued - the definitive empty state, not a blank area. |
| `stale` | Valid content generated long ago. Renders, with every lens marked stale. Its health signals read cleanly and have something to report: a supervision cycle last seen a while back, a notification queue that is not draining, an operator away with the home unlocked, one overdue item, one record that disagrees. |
| `mismatched` | A schema identifier this build does not understand. The loud typed refusal, and no lens rendered at all. |
| `malformed` | A truncated snapshot beside a healthy health file. Fleet and deck go dark; shipshape stays current. |
| `health-dark` | No `health.json` at all. Shipshape goes dark on its own while fleet and deck render normally. |
| `health-unread` | A health file that reads cleanly and whose five signals each report that they could not be read. The lens is `fresh`; its contents are not. |
| `deck-dark` | Upstream reporting `backlog.present: false`. The deck goes dark alone, and this home's own landed work goes with it - but a second mate's landed work, rolled up separately, survives. |
| `deck-only` | An empty fleet with a non-empty deck. |
| `fleet-only` | A non-empty fleet with an empty deck. Every stage the document can carry, including a worker the panel cannot see - whose detail names a pipeline step, so that nothing may quietly place it on the track from words upstream wrote about its own blindness. Nothing was recorded at dispatch for any of them and no forge was read, which is the all-absent end of every field version 4 added. |
| `fleet-empty-stale` | A stale read that found nothing running, with a non-empty backlog. The last good picture is empty, but it still shows its age rather than reading as a clean current empty state. Its health file holds the fourth combination of away and lock - away, with the home still held - which no other set carries. |
| `crowded` | Thirty workers and fifteen deck rows: the large end of the range the layout has to survive, and the set the shell's proportions were tuned against. Five rows are held - four for a person, three of those answerable right now - three workers are past the wedge line and two records disagree with reality, so every band carries more than fits. Two thirds of its workers were dispatched with a contract, branch, runtime, model and effort recorded and the rest with nothing; of its five pull requests, one has a forge that could not be read, three have readings, and one was never asked about at all - and none of them is merge-ready, which is what makes it the set that proves a button is not offered over a reading nobody took. See docs/decisions/2026-08-31-what-needs-you-owns-the-first-screen.md. |
| `wide-detail` | A snapshot whose refusal quotes what it refused: a 180-character run with no space, hyphen or slash in it, which is the shape that used to burst out of a lens frame sideways. Fleet and deck dark, shipshape current. Its health file is also the one that predates the two signals document version 4 added, deliberately: those two read as unreadable while the three it does carry keep working, which is the tolerance that stops an older file darkening a whole lens. |
| `all-dark` | A truncated snapshot with no `health.json` beside it. Every lens dark at once and nothing left to draw - the page with the least on it the panel can still be asked to render, and the one that has to keep reading as one instrument. |
| `upstream-shape` | A synthetic fleet in upstream's real shape and real vocabulary: every state a live fleet reconciles to, a project recorded as a path, a kind this build has never seen, numeric priorities, a start date rather than an instant, a row with no start, no project and no kind at all, a row asking for research, a backlog line nobody turned into a work item, and a deferral that is not a date. It carries the real delivery vocabulary - `no-mistakes`, `direct-PR`, `local-only`, `secondmate`, and a scout with no mode at all - and, exactly like a live fleet, no branch, model, effort or brief text, and a pull request with nothing about the forge beside it. Its one landed row carries a completion date that is a whole sentence, which is what a live fleet was found writing there. The set that keeps the real read honest without a real fleet. |

Every field the document carries has a fixture in every state it can hold,
including its absent and unreadable forms. That is not tidiness: a field with no
fixture is a field the next reader cannot test against, and this document is
built against by several workers at once. When a field is added, the sets above
gain the states it can be in, and this table says which set holds which.

`generated` in the fresh sets sits far enough in the future that they never
drift into looking stale as the repository ages. `stale` is fixed in the past on
purpose.

The sets above are the pages worth pointing the panel at and looking at. They
are not the whole degradation matrix: fleet and deck share the snapshot's
`generated` and health is read separately, which makes fifteen reachable
combinations of the three lens statuses, six of which differ from a set above by
one timestamp. `tests/degradation.test.ts` composes all fifteen from a copied
fixture and drives each through the built server, rather than committing six
directories whose only distinguishing feature is a date.

Every set is written in the shape upstream actually publishes, so a snapshot
here can be dropped in front of the parser exactly as a fleet's own would be.
Where upstream's vocabulary is coarser than the document's - a live fleet
reconciles to seven states, and the panel draws more positions than that - the
older sets use the finer values so the whole lifecycle rail has something to
draw. `upstream-shape` uses only what a live fleet emits; see
docs/contract.md - upstream's state vocabulary.

## Fleet homes

`homes/` is not a fixture set: it holds synthetic **fleet homes**, the shape the
quarantined health module reads. A fleet home is somebody else's directory
layout with no compatibility promise attached, so these exist to be broken - the
tests copy one, move or delete a path inside it, and assert the lens degrades
instead of the panel falling over.

| Home | What it exercises |
| --- | --- |
| `steady` | A fleet running normally: workers busy, one idle for an hour having declared why, a work item record that agrees with what the workers are doing, a queue with two notifications on it, and no away or lock marker. |
| `adrift` | A fleet with something wrong in it: one worker idle past the point that is normal with nothing declared, one whose busy record carries a retired incarnation token, one work item held after its decision was answered, one in flight with no worker behind it, an empty queue file, and both the away and lock markers present. |
| `moved` | Upstream restructured: the state directory is not a directory any more. Every signal reads unreadable and nothing throws. |
| `unstarted` | A home with a backlog but no state directory at all - discovered before its first supervisor tick. Every signal that lives in state/, including the queue, reads unreadable rather than one of them reporting a fabricated empty reading. |

None of them carries the liveness beacon, because the beacon holds nothing but
its modification time and git does not carry those - a committed one would be as
old as the checkout. Each test writes the beacon it means into its own copy.

The panel reads a real fleet home when one is configured, and the fixture
`health.json` above when one is not:

```sh
QUARTERDECK_FLEET_HOME=/path/to/a/fleet npm start
QUARTERDECK_FLEET_HOME=/path/to/one:/path/to/another npm start
```

A home's last path segment is what the picker calls that fleet; two homes
sharing one still get distinct handles.

## Adding a set

Add the directory, then add its row to `SHAPES` in `tests/document.test.ts`.
That test asserts the set of directories on disk matches the sets it walks, so a
new fixture with no expectation fails rather than going unchecked.
