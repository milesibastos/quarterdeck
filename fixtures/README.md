# Fixture fleets

Every fleet in here is invented. The project names, work item ids and paths do
not correspond to anything real, and never may: this repository is public and
the tool it holds reads a private fleet. Test material has been synthetic since
the first commit so that nobody ever has to decide, later and in a hurry,
whether a particular sample is safe to publish.

`npm test` asserts this: a leak guard greps every tracked file, plus every
uncommitted file that is not gitignored, for home directories, absolute
machine paths and real operator identifiers.

Which set the panel reads is a config value, not a code change:

```sh
QUARTERDECK_FIXTURE_SET=stale npm start
```

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
| `healthy` | A worker in every coarse stage, on-track and off, plus both validating shapes - a detail that names a pipeline step and one that names none. A deck with something queued, something blocked by another item, something held for a person with a reason and a deferral date, and one done record the projection drops. Health signals good. |
| `empty` | A clean read of all three lenses that reports nothing running and nothing queued - the definitive empty state, not a blank area. |
| `stale` | Valid content generated long ago. Renders, with all three lenses marked stale. Its health signals read cleanly and have something to report: a supervision cycle last seen a while back, one overdue item, one record that disagrees. |
| `mismatched` | A schema identifier this build does not understand. The loud typed refusal, and no lens rendered at all. |
| `malformed` | A truncated snapshot beside a healthy health file. Fleet and deck go dark; shipshape stays current. |
| `health-dark` | No `health.json` at all. Shipshape goes dark on its own while fleet and deck render normally. |
| `health-unread` | A health file that reads cleanly and whose three signals each report that they could not be read. The lens is `fresh`; its contents are not. |
| `deck-dark` | Upstream reporting `backlog.present: false`. The deck goes dark alone. |
| `deck-only` | An empty fleet with a non-empty deck. |
| `fleet-only` | A non-empty fleet with an empty deck. |

`generated_at` in the fresh sets sits far enough in the future that they never
drift into looking stale as the repository ages. `stale` is fixed in the past on
purpose.

## Adding a set

Add the directory, then add its row to `SHAPES` in `tests/document.test.ts`.
That test asserts the set of directories on disk matches the sets it walks, so a
new fixture with no expectation fails rather than going unchecked.
