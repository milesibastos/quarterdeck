# The fleet read budget, and what a timeout means

2026-09-01

An operator started the panel against a real fleet home and it opened with three
of its four lenses unreadable, four times over:

```text
QUARTERDECK_FLEET_HOME=/…/quarterdeck npm start
✓ Ready in 0ms
[quarterdeck] info watching for fleet changes {"watchDir": ".../state"}
[quarterdeck] info watching for fleet changes {"watchDir": ".../data"}
[quarterdeck] warn fleet read failed; showing the fleet, deck and landed
  lenses as unreadable {"detail": ".../bin/fm-fleet-snapshot.sh The operation was aborted"}
quarterdeck listening on http://127.0.0.1:45229
[quarterdeck] warn fleet read failed; ... The operation was aborted
[quarterdeck] warn fleet read failed; ... The operation was aborted
[quarterdeck] warn fleet read failed; ... The operation was aborted
```

The obvious reading is that five seconds was too few and the number wanted
raising. That is a third of the answer. The other two thirds are that the panel
was making the problem worse every time it noticed it, and that the word
`failed` was false.

## Three findings, measured

### One: five seconds was never a defensible number

The snapshot is a command, not a file, and its cost grows with the fleet. On a
quiet machine, against a real home whose live workers were removed one at a
time - best of three runs each, so these are floors and not averages:

| live workers | `fm-fleet-snapshot.sh --json` |
| ------------ | ----------------------------- |
| 0            | 0.10s                         |
| 1            | 0.40s                         |
| 2            | 1.77s                         |
| 3            | 2.55s                         |
| 4            | 3.62s                         |

About a second per live worker, in series. The same home under its ordinary
load - the supervisor running its own snapshots alongside - measured 4.95s at
three workers, so real load roughly doubles the floor. Five workers idle, or
three under load, and the panel gives up.

Where the time goes is not the terminal reads it was assumed to be. A timestamped
`bash -x` trace puts the whole of it in one call per task: `fm-crew-state.sh`,
at 0.95s each, run one after another.

The number that settles it is upstream's own. Each of those per-task reads is
bounded by the fleet's own timeouts - `FM_SNAPSHOT_CREW_STATE_TIMEOUT` at 10s,
plus 2s of terminal capture and 2s of activity read. Upstream permits itself
fourteen seconds for **one** worker. A panel that gives up at five has given up
before the fleet's own deadline has fired even once, which means the panel
cannot tell a fleet that is stuck from a fleet that is merely working: it stops
watching before upstream would have reported either.

So the default is 20s. It is the smallest round number above upstream's own
single-worker bound, it covers about sixteen live workers at the measured floor
or eight under the load factor above, and it stays a third of the 60s staleness
window, so a read that only just makes it still produces a page that reads as
current rather than one that arrives already stale.

That is a budget, not a fix. A fleet several times this size will still outgrow
it, and the panel now says so in words an operator can act on rather than
implying the fleet is broken.

### Two: a deadline abandons the wait, not the work

This is the one that turns a slow read into a storm.

`AbortSignal` reaches `execFile`, which signals the direct child. Upstream runs
its expensive readers through `fm_run_timed`, which puts each of them in a
process group of its own - deliberately, so that a hung grandchild cannot outlive
its bound. Nothing this panel is permitted to send reaches into those groups.

Measured directly, aborting a real snapshot at 1.5s and watching its process
group:

```text
[0.54s] processes in the spawned group: 8
[1.50s] node call settled: The operation was aborted
[1.54s] processes in the spawned group: 7
[3.05s] processes in the spawned group: 7
[5.55s] processes in the spawned group: 7
[6.06s] processes in the spawned group: 1
```

The abort removed one process. Seven kept running for four and a half more
seconds, to natural completion. The panel stopped waiting; the fleet did not stop
working. Every abandoned read is a full-price snapshot the machine pays for and
nobody reads.

**This cannot be fixed inside quarterdeck.** Killing the process group would need
a second spawner, which the invariants forbid and should: confining "what can
this panel start" to one reviewable file is worth more than a tidier abort. And
the mechanism that escapes is upstream's, in a repository this one cannot ship
to. It is recorded here as a fact the budget has to be chosen around, not as
something outstanding.

### Three: the panel fed its own storm

`#inFlight` collapses callers that arrive together. It does nothing for callers
that arrive one behind the other, and a watched fleet produces exactly those: the
watcher fires, every open page re-renders, and each render is a fresh
`document()` after the last one settled. A read that failed left `#stale` set on
purpose, so every one of those renders started another read of a source that had
just proved it could not answer inside the budget.

Reproduced against a fleet home whose snapshot command escapes the abort the way
the real one does, budget 1.5s, command 5s, six page renders:

```text
  0.00s  start   concurrently running=1
  1.76s  start   concurrently running=2
  3.27s  start   concurrently running=3
  4.79s  start   concurrently running=4
  5.03s  end     concurrently running=3
  …
MAX CONCURRENT snapshot commands doing real work: 4
aborts logged: 7
```

Six renders, seven reads, four full-cost snapshot commands running at once, every
one of them already thrown away. The panel was making the fleet slower by asking
it whether it was slow, and the steady state is not a spike but an equilibrium:
a new command every 1.5s, each living 5s, for as long as anybody keeps the page
open.

The same run against the same home after the change:

```text
  0.00s  start   concurrently running=1
  5.02s  end     concurrently running=0
MAX CONCURRENT: 1   TOTAL SPAWNS: 1
```

One read, one warning, and the six renders return in five milliseconds each
instead of blocking for the budget apiece.

## What changed

**A failed read buys quiet, in proportion to what it cost.** `holdOffMs` waits
at least as long as the attempt that just failed - which is the honest number,
because that is how much fleet work the abort left running - with a one-second
floor so a command that is simply missing does not spin the render loop, doubled
per consecutive failure so a fleet that is down is asked about less and less
often, and capped at the staleness window. Past that window the panel is calling
its own last good picture stale anyway, so holding off longer buys quiet nobody
is left to benefit from.

Renders arriving inside the hold-off are answered from what the last failure
knew, without reading. Two things are deliberate about that answer. The health
signals _are_ re-read each time, because they come from a different reader with a
different cost - files, no command - and letting the shipshape lens go dark for
the length of a backoff would be the panel withholding the one thing it can still
see. And nothing is restamped: the failure's own `observedAt` is carried, so the
page keeps saying "the read failed twenty seconds ago" instead of claiming a
fresh read had just failed on every render when none was attempted. That is what
`SnapshotFailure` exists to carry.

**Acting steps over the hold-off, and only acting.** `reread()` is an operator
with a finger on a button, and telling them to come back in half a minute because
a render failed earlier would spend their patience to save the fleet's. One
attempt per press is not a storm. The attempt count is stepped over rather than
cleared, so a press that fails again leaves the renders behind it backing off
further rather than starting the escalation over.

**The forge keeps the budget it had.** `QUARTERDECK_READ_TIMEOUT_MS` was being
handed to the `gh` reader as well, so raising it from 5s to 20s would have
silently bought a hung network call three times longer to hold up the rest of
its batch. The fleet's number is sized against a cost that grows with the fleet;
one forge request has no such curve. `FORGE_READ_TIMEOUT_MS` is now its own
constant, and stays at five seconds.

**One deadline spans both reads.** Health and the snapshot ran in sequence with a
fresh `AbortSignal.timeout` each, so the real budget was twice the configured
number - and the configured number is the one the page now quotes back to the
operator.

**A slow fleet and a broken fleet are two different facts.** `LensStatus`'s
`unreadable` gains a `reason`, and the document goes to version 6.

`failed` is the fleet answering badly: the command is not there, it refused, or
what came back would not parse. Something is wrong and the detail names it,
verbatim, as before.

`timed-out` is the fleet not answering in time. Nothing is wrong with it. The
badge reads `Timed out` rather than `Could not be read`, and the line beneath it
says what the cost curve is and which setting raises the budget:

> The fleet did not answer within 20s. A snapshot costs roughly a second per live
> worker, so a large or busy fleet can outrun the budget - this is slowness, not
> a fault. It will be asked again shortly; QUARTERDECK_READ_TIMEOUT_MS raises the
> budget.

The verb is derived in one place - `readVerb` - rather than written into each
band. The badge was changed first and the bodies were not, which put `Timed out`
in a header two inches above "the read failed" in the body of the same card:
the page telling an operator both that their fleet is fine and that it is
broken, with the second being the one they would act on. Two rendered shapes
have to be checked and only one is obvious - a first read that never landed,
where the lenses have nothing behind them, and a fleet that answered once and
then stopped, where they are still showing the last good picture and have to
date it. The second is where the wrong word survived, and a test that only
covered the first passed with the fault deliberately put back.

An operator can act on that. They cannot act on "failed", and being told their
fleet is broken when it is only busy is the panel making a claim it has no
evidence for - which is the same rule the disclosure bar is built on.

## What was considered and not done

**A different budget for the first read.** A cold start has no last-known-good,
so a timeout there opens the panel empty rather than stale, which is the worst
version of this. A larger first budget was the obvious answer and is the wrong
one: the first paint _blocks_ on that read - the launcher does not print its URL
until the page answers - so buying a first read more time buys the operator a
longer silent start against exactly the large fleet where they are least likely
to wait for it. The real answer is a first paint that does not wait: render
"reading the fleet", publish a change when it lands. That is a bigger change than
this one and is named here rather than smuggled in.

**Raising the number alone.** It moves the cliff and nothing else. Every finding
above is still true at 20s, at 60s, and at any number, because the cost grows
with the fleet and the retry behaviour was independent of the budget.

**Making the abort actually stop the work.** See finding two. It needs a second
spawner or a change upstream, and the first is forbidden for a better reason than
this one is worth.

## What is still true, and is upstream's

The snapshot's cost is linear in live workers, serial, and uncached, at roughly a
second each on an idle machine and upstream's own bound of fourteen seconds
apiece in the worst case. Nothing in this panel can change that; a fleet large
enough will time out however the budget is set, and the panel's job is then to
say so honestly rather than to pretend it read something. The fix that would
actually remove the ceiling - concurrency or a cache inside
`bin/fm-fleet-snapshot.sh` - belongs to the repository that owns that file.

There is a second, quieter cost that the backoff does not touch and should not.
A fleet writing to `state/` faster than one snapshot completes keeps the panel
reading continuously: the watcher fires, the read succeeds, success clears the
backoff, and the next event starts another. That is not a storm - `#inFlight`
and the success reset hold it to exactly one read at a time - but it is about
one full-cost snapshot per read-duration, indefinitely, for as long as the fleet
is busy and a page is open. Backing off after a _successful_ read would be the
panel deciding an operator may not see their fleet move, which is the opposite
of what it is for.

The fix is upstream's, and it is already on that fleet's own backlog as
`fm-snapshot-cadence-e2`: republish the snapshot on a cadence so a file-watching
surface reads a file instead of running a command. On that day this panel's read
becomes a file open, the budget stops mattering, and everything above becomes
history rather than policy.
