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

## Two files per set

The panel has two readers, with two different promises, so a set has two files.

- `snapshot.json` - the upstream contract, carrying the fleet and the deck. It
  parses or it refuses; the schema identifier is pinned.
- `health.json` - the panel's own shape, read by the quarantined module. It may
  be absent, malformed or partly unreadable, and the module degrades rather than
  throwing.

That is why a set can be dark in one lens and current in the others, and every
combination below has somewhere to live.

| Set | What it exercises |
| --- | --- |
| `healthy` | A worker in every coarse stage, on-track and off, plus both validating shapes - a detail that names a pipeline step and one that names none. A deck with something queued, something blocked by another item, something held for a person with a reason and a deferral date, another held for a person with no deferral so it can be answered outright, one held for something that is not a person and so cannot be answered at all, and one done record the projection drops. Health signals good. |
| `empty` | A clean read of all three lenses that reports nothing running and nothing queued - the definitive empty state, not a blank area. |
| `stale` | Valid content generated long ago. Renders, with all three lenses marked stale. Its health signals read cleanly and have something to report: a supervision cycle last seen a while back, one overdue item, one record that disagrees. |
| `mismatched` | A schema identifier this build does not understand. The loud typed refusal, and no lens rendered at all. |
| `malformed` | A truncated snapshot beside a healthy health file. Fleet and deck go dark; shipshape stays current. |
| `health-dark` | No `health.json` at all. Shipshape goes dark on its own while fleet and deck render normally. |
| `health-unread` | A health file that reads cleanly and whose three signals each report that they could not be read. The lens is `fresh`; its contents are not. |
| `deck-dark` | Upstream reporting `backlog.present: false`. The deck goes dark alone. |
| `deck-only` | An empty fleet with a non-empty deck. |
| `fleet-only` | A non-empty fleet with an empty deck. |
| `fleet-empty-stale` | A stale read that found nothing running, with a non-empty backlog. The last good picture is empty, but it still shows its age rather than reading as a clean current empty state. |
| `upstream-shape` | A synthetic fleet in upstream's real shape and real vocabulary: every state a live fleet reconciles to, a project recorded as a path, a kind this build has never seen, numeric priorities, a start date rather than an instant, a row with no start at all, a backlog line nobody turned into a work item, and a deferral that is not a date. The set that keeps the real read honest without a real fleet. |

`generated` in the fresh sets sits far enough in the future that they never
drift into looking stale as the repository ages. `stale` is fixed in the past on
purpose.

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
| `steady` | A fleet running normally: workers busy, one idle for an hour having declared why, and a work item record that agrees with what the workers are doing. |
| `adrift` | A fleet with something wrong in it: one worker idle past the point that is normal with nothing declared, one whose busy record carries a retired incarnation token, one work item held after its decision was answered, and one in flight with no worker behind it. |
| `moved` | Upstream restructured: the state directory is not a directory any more. Every signal reads unreadable and nothing throws. |

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
