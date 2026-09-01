# The band still sat in the kernel's range

Date: 2026-09-01
Status: accepted

The panel range this decision left unfixed was moved out of the kernel's way
on the same day; see
`2026-09-01-the-panel-band-clears-every-kernel.md`. Every "45000-45999" below
is the panel range as it was before that.

Follows `2026-09-01-test-ports-live-above-the-panels.md`, which moved the
suite's ports to 46000-46999 to stop them landing on a foreign panel. That
band still collided, on CI, for a different reason.

## Context

A CI run failed `tests/fleet-lens.test.ts` with an EADDRINUSE the suite did
not expect: `startPanel` checked the port first and found nothing answering,
then the spawned child died binding it anyway, and by the time anything asked
who was on the port, nothing was. That is the exact shape `startPanel`'s own
comment already names as an open window - "a foreign server can take the port
between the check and the panel's bind" - except there was no sibling checkout
on that runner to be the foreign server.

There did not need to be one. `tests/lib/band.ts` placed the band "below the
ephemeral range (49152+ on macOS and Linux)", and `tests/harness.test.ts`
asserted exactly that number. It is true for macOS and false for Linux: a
default `ip_local_port_range` of 32768-60999 is the common case on a Linux
box, which is what a hosted CI runner is. 46000-46999 sat inside it.

That range is where the kernel picks the _source_ port for an outbound
connection, and this suite's own test clients are the ones making them -
hundreds of `fetch` calls a run, each to a panel this same process is driving.
One of those source ports landing on a number a not-yet-started panel is about
to `listen()` on produces the identical EADDRINUSE a foreign panel would,
except transient: the squatter is a client socket, not a listener, so
`whatAnswersOn` - which connects, not binds - reports nothing both before the
bind and after the child dies. Nothing was left to name.

## Decision

**The band moves to 29000-29999.** Below 32768, so the kernel cannot hand one
of these out as a Linux ephemeral source port; below 49152 for the same reason
on macOS; and below 30000-32767, which Kubernetes reserves for NodePort
services a runner might have one of bound. `tests/lib/band.ts` is the only
file that names the number.

Which thousand, among the several that satisfy those three, was settled by
`/etc/services`: 29000-29999 carries one registered service (29167, ObTools
Message Protocol), where 20000-20999 - the first band picked here - carries
thirty, including DNP3 on 20000 itself. A band chosen against the constraints
beats one that merely happens to be free, which is the whole lesson of the
two moves above it.

`tests/harness.test.ts`'s ephemeral-floor assertions move from 49152 to
32768: the tighter of the two real floors, and the one that was wrong to
treat as satisfied by a number below the looser one.

## Why not retry the bind

A transient squatter clears once its connection closes, and a bind that failed
only because of timing would very likely succeed a moment later - which makes
retrying the spawn look like the smaller change, and it was considered. Two
things ruled it out. First, `whatAnswersOn`'s own probe reports "nothing" for
this exact case whether the squatter is still there or not, because it asks
who _listens_, not who holds the port - so the one signal a retry would need
to tell "clear now" from "still taken" does not exist. Second, the squatting
sockets are exactly the kind Node and undici keep alive after use, on the
order of seconds, not milliseconds - a bind retried quickly would have a real
chance of landing on the same socket again. A fix that closes the window
outright does not carry either problem.

## Consequences

Reported test-server ports move again: 29000-29999 instead of 46000-46999.
Nothing names one outside `tests/lib/band.ts` and `tests/harness.test.ts`.

`src/config/port.ts` carries one behaviour-preserving comment correction: its
range comment claimed the panel range sits below the ephemeral floor "on
macOS and Linux", which this decision's own finding disproves for Linux, so
the comment now states what is actually true for each platform and points
here. No derivation, range, or other product code changed. The panel
range, 45000-45999, sits inside Linux's default ephemeral range too, and a
panel binding once at process start is a far smaller target than a suite
making hundreds of outbound calls across tens of seconds - this was noted here
and left as a live but much smaller risk than the one this decision closes. It
did not stay open long: see
`2026-09-01-the-panel-band-clears-every-kernel.md`.

## Pointer

`2026-09-01-test-ports-live-above-the-panels.md`'s "above the panels" framing
and its "46000-46999" numbers are the range as it was between these two
decisions; a note under its Status line points here.
