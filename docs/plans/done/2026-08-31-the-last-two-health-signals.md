# The last two health signals

2026-08-31. Landed.

## What was built

The shipshape strip draws all five of the wireframe's questions. Two of them -
is the notification queue draining, and is away mode on with the home locked -
were carried in the document with fixtures behind them and nothing drew them.
This pass drew them, and nothing else: the document shape, the quarantined
module and the projection were already complete and are untouched.

- `thresholds.ts` - `QUEUE_BACKED_UP_AT` (four), beside the word the copy uses
  for it, on the same terms as the supervision threshold above it.
- `shipshape-lens.tsx` - a `Queue` block and an `Attendance` block, in the
  wireframe's order: supervision, queue, attendance, overdue, drift.

Five signals now, each independently `ok` or `unreadable`, each with a verdict
slug of its own: queue is empty/draining/backed-up/unreadable, attendance is
present/present-held/away/away-held/unreadable. Nothing outside
`src/ui/shipshape/` changed.

## Decision log

**Four, and the boundary belongs to the concern.** The document carries a depth
rather than a verdict, deliberately - reading a number as a problem is the
lens's judgement. Four is upstream's own note on where a queue stops being a
pipe with work in it and starts being a fleet that has stopped delivering, and
the comparison is `>=`, so a queue holding exactly four has already crossed.
`tests/shipshape-lens.test.ts` pins which way round that is, against the `stale`
set, which holds exactly four.

**A queue with things in it is not a fault.** One, two or three queued is the
queue working and is drawn as such - a `watch` tone on every non-zero depth
would train an operator to ignore the signal, which is the failure mode this
lens exists to avoid. Zero is a separate verdict from a small depth because it
is a separate finding: read and found empty.

**One attendance block, two entries inside it.** The wireframe asks away mode
and the home lock as two entries and they are drawn as two entries - but inside
one block, because the document carries them as one signal that goes dark in one
piece. Two blocks could only say the same failure twice, and would put six
blocks on a strip that has five signals. The block's single verdict carries
both facts (`away-held`, `present-held`), which is the one thing that can
honestly be said about the pair.

**Away is something to look at; a held home is a fact.** Away mode changes how
what the fleet raises reaches the operator, so it takes the `watch` tone. A lock
is the ordinary state of a fleet with a session running - the `healthy` set has
one - so it is stated rather than flagged. Neither is a fault, and the block
never claims the session holding the lock is still alive: that is the fleet's
own liveness policy, and reimplementing it is what the quarantine refuses. See
the gap in `docs/quality.md`.

**Acceptance three, honestly.** "Breaking each new source in turn darkens only
its own signal" holds for the queue and is now tested at the source: a directory
where `state/.wake-queue` should be is a queue that exists and will not open, so
it goes dark while the other four keep reading. It cannot hold for attendance,
by a design that predates this pass: away mode and the lock are read from one
listing of `state/`, which overdue and drift also need, so whatever hides them
hides those too - `tests/health.test.ts` asserts that joint failure rather than
pretending to an isolation the module does not have. What is pinned instead is
the seam the lens consumes: a document with exactly one dark signal draws
exactly one dark block, keeps the other four verdicts, and leaves fleet and deck
alone. Both new signals get that test.

**No new fixture set.** The committed sets already cover every state both
signals can hold: all three queue verdicts (`healthy` empty, `upstream-shape`
and `fleet-empty-stale` draining, `stale` and `crowded` backed up), all four
attendance verdicts (`healthy` present-held, `empty` present, `stale` away,
`fleet-empty-stale` away-held), both unreadable (`health-unread`), and both
absent from a health file that predates them (`wide-detail`). The one-signal-
dark documents are written into private fixture copies inside the test, the same
way the mixed reading already was.
