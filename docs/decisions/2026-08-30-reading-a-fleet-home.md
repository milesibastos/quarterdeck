# Health reads a fleet home, and reads it defensively

Date: 2026-08-30
Status: accepted

## Context

Three of the panel's four lenses arrive through a versioned contract that either
parses or refuses. The fourth does not. Whether the supervision machinery is
itself alive can only be read from the fleet's own working files: a beacon the
supervision cycle touches on every poll, one busy record per worker it has out,
each worker's status log, and the durable work item record. None of those is
published, versioned or promised to anyone. They move.

That is also the lens an operator misses most: of the earlier attempts at fleet
visibility in this ecosystem, one covered whether the thing doing the
supervising had quietly stopped, and it never landed.

## Decision

The quarantined module reads a fleet home named by `QUARTERDECK_FLEET_HOME`,
and produces the same signals as the fixture health file. Where each comes
from is recorded in `docs/contract.md`. With no fleet home configured, the panel
reads the fixture health file exactly as before.

Three rules come with it:

**Every path and both thresholds stay inside `src/adapters/health.ts`.** The
paths because invariant 4 says so. The thresholds - the beacon's grace window
and the point an idle worker becomes a possible wedge - because they are the
fleet's own policy numbers, not the panel's preferences. Exposing them as
configuration would invite an operator to tune the lens into disagreeing with
the fleet it is watching.

**A surprise is "could not be read", never a guess.** A busy record that is
missing, malformed, or carrying a retired incarnation token is unknown, which is
upstream's own rule for the same data. Free-form lines in the work item record
are skipped rather than parsed hopefully. A status verb the fold does not know
is an ordinary event, not a format change.

**The signals fail separately.** One directory moving takes the signals
that needed it and leaves the rest. Only the home itself being absent darkens
the whole lens - the one failure that says nothing about any individual signal.

## Why not put this behind the contract instead

Because it would make the panel's one loud, honest refusal quieter. The pinned
snapshot identifier can promise that a shape change refuses rather than renders,
precisely because upstream maintains that identifier. Nothing maintains the
layout of a fleet home. Pinning something nobody promises would produce a
refusal on an ordinary upstream release, and the lenses fed by the snapshot
would go down with a change that has nothing to do with them.

## Trade-offs

**The lens can be confidently wrong about liveness in one direction.** A beacon
that moved and a supervision cycle that stopped are the same observation from
outside. Missing is reported as unreadable rather than as dead, so a moved path
costs the operator a signal instead of raising a false alarm - and the tests
name the beacon in the detail line, so the operator can see which path did not
answer.

**A declared wait is trusted.** `paused:` and `captain-held:` mean an idle
worker is idle on purpose, and neither is reported. A worker that declares a
pause and then genuinely wedges is invisible to this lens until the declaration
is removed. Reporting declared waits instead would make the signal noisy enough
to ignore, which is worse.

**Fixture homes cannot carry their own beacon.** The beacon's entire content is
its modification time, and git does not carry those, so a committed one would be
as old as the checkout. Each test writes the age it means into its own copy;
`fixtures/homes/` therefore ships no beacon, and the absent-beacon case is the
one the fixtures cover directly.
