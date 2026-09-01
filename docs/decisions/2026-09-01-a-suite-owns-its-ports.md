# A suite owns its ports, or refuses to run

Date: 2026-09-01
Status: accepted

## Context

`docs/decisions/2026-08-31-one-port-block-per-test-file.md` keeps this suite's
own files off each other's ports. It can say nothing about the rest of the
machine. Test ports are derived from the worktree's absolute path into
45000-45999, the same range `derivePort` puts every checkout's panel in, so a
sibling checkout - another worktree, another agent's lane, an author's own
`npm start` - can be sitting on a port this checkout's suite is about to use.

Nothing about that looks like a port clash. The foreign server answers. The
panel that failed to bind is never mentioned: `stdio` was `"ignore"`, so its
EADDRINUSE went nowhere, and `waitForReady` asked only whether _something_
answered the URL, which something did. Every request the file made was served
by a fleet it never asked for.

On 2026-08-31 this cost two workers and firstmate three wrong diagnoses - first
"pre-existing base defect", then "concurrent load" - before a worker settled it
with five pieces of evidence. Firstmate had been testing in the primary
checkout, the one place that can never observe the problem, and so told every
worker the wrong thing. The one line that ended it was a curl of the port,
which returned the failing assertion's text verbatim.

**Wrong content, not a bind error, is the whole defect.** A bind error names
itself and costs a minute. A content assertion sends a reader into the panel
looking for a bug that is not there, and the closer they read the more
convinced they get, because the content really is wrong - just not for the
reason the test implies.

There is a second face, found while proving this one, that is worse. When the
foreign panel happens to serve what the file expected, the file passes. Below,
`tests/width.test.ts` goes green five for five against a server this suite did
not start. A false failure costs a day; a false pass costs whatever it was
guarding.

## Decision

**`startPanel` asks who is on the port before it spawns anything, and refuses.**
The refusal quotes what the port said, states that a foreign occupant would have
been believed, explains that ports are derived per worktree, and prints the
`lsof` line that finds the holder. Everything the 2026-08-31 diagnosis had to be
reconstructed from is in the failure itself.

**The probe connects; it does not bind.** These are different questions. Node's
listeners set `SO_REUSEADDR`, so binding 127.0.0.1 can succeed while a foreign
process holds 0.0.0.0 on the same port - a probe that passes while that server
goes on answering every request the suite makes. `bin/quarterdeck` binds because
it is about to bind. A test needs to know what it would be talking to, which is
a question only a connection answers.

**The window between the check and the bind is closed on the other side.**
A check cannot be atomic with a spawn, so a foreign server can still take the
port in between. `startPanel` therefore keeps the child's stderr and treats a
panel that died unbidden as a finding rather than a stop, and
`explainEarlyDeath` reads that death together with whatever answers on the port
_now_: a dead panel cannot be what replied, so anything still answering is what
the file was asserting against. EADDRINUSE in the child's last words, an
occupant on a dead panel's port, and a silent port after a crash are three
different sentences, and only the third blames the panel.

## The proof

`tests/width.test.ts` derives port 45341 and asks its own panel for the
`crowded` fixture set. A second panel is put on 45341 serving a different
fleet, playing the sibling checkout.

```console
=== 1. Before the fix, a foreign panel serving a different fleet ===
$ lsof -nP -iTCP:45341 -sTCP:LISTEN -t   ->  89737 (the foreign panel, fixture set 'empty')
✖ a wider viewport buys more cards (48.700042ms)
ℹ tests 5
ℹ pass 3
ℹ fail 2
✖ three widths, three column counts, at one card size
  AssertionError [ERR_ASSERTION]: no card grid found for decisions
✖ one card, and no sideways overflow, on a phone
  AssertionError [ERR_ASSERTION]: no card grid found for decisions
$ lsof -nP -iTCP:45341 -sTCP:LISTEN -t   ->  89737 (unchanged: this file's own panel never bound, and nothing said so)

=== 2. Before the fix, a foreign panel serving the same fleet ===
ℹ tests 5
ℹ pass 5
ℹ fail 0
green, five for five - against a server this suite did not start.

=== 3. After the fix, the same foreign panel ===
  Error: port 45341 is already answering, and this suite did not start what is on it.
  It said: HTTP/1.1 200 OK content-security-policy: default-src 'self'; base-uri 'self'; ...

  This panel would not have bound, and nothing would have said so: every request this file
  made would have been answered by that server, and the assertions would have failed as
  wrong content rather than as a port clash.

  Test ports are derived from this worktree's absolute path, inside 45000-45999, so a panel
  or a suite in a sibling checkout can land on one of this checkout's. Find it with:
    lsof -nP -iTCP:45341 -sTCP:LISTEN
  then stop it, or stop the checkout it belongs to, and run this suite again.

=== 4. The foreign panel stops; nothing else changes ===
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Act 1 is the reported defect: two content assertions, and the `lsof` either side
showing that the file's own panel never held the port. Act 2 is the face nobody
had seen. Act 3 is what a worker reads now. Act 4 is that nothing else moved.

The normal case is untouched, which matters because the panel an author leaves
running is on a port in this same range: with this worktree's own panel up on
its derived port 45659, `npm test` is 470 for 470, and that panel is still
answering afterwards. `tests/harness.test.ts` holds the same proof as a test,
squatting ports from its own block rather than a neighbour's.

## Consequences

A port in this suite's blocks that anything else is using now stops the run
instead of being shared. That is the point, but it means a developer who leaves
a stray server on 45000-45999 gets a failure rather than a mystery - the failure
tells them which port and how to find the process.

Every `startPanel` pays one loopback connect, which on a free port is a refused
connection: sub-millisecond, and about a hundred of them across the suite.
Against that, the probe's one-second timeout is spent only when something _is_
on the port, in which case the run is ending anyway.

The child's stderr is now kept rather than discarded, to a four-kilobyte tail.
A panel that dies for its own reasons prints its own last words, which it did
not before.

Finding that stray server is not as simple as the failure implies. `pkill -f`
matched against the path the panel was launched with finds nothing once the
panel is up, because Next renames the process title to `next-server
(v16.3.3)` - a worker can run that pkill, see a clean `pgrep`, believe every
server is stopped, and leave them holding their ports anyway. The reliable
identification is the working directory, not the command line: `lsof -a -p
<pid> -d cwd` names the checkout a process belongs to, which is also how a
worker tells their own leaked panels apart from a genuine sibling checkout
they must not kill.

On 2026-09-01 this guard made its first catch outside its own worktree: a
docs-only branch, against nineteen panels a worker had leaked and believed
stopped. The first diagnosis of that failure attributed the occupants to an
unrelated checkout - wrong - and only the working-directory check settled who
they belonged to. Before this guard existed, that run would have asserted
against those panels: wrong content, or a false pass if they happened to serve
the same fixtures, which is act 2 of the proof above.

## Alternatives considered

**Widening what is reserved, so the block covers what a sibling could use.**
There is nothing to widen it against. Every checkout derives into the same
thousand ports by design - that is what lets two panels run at once - so any
block wide enough to exclude every sibling would be the whole range, and one
checkout would own the range. Reserving is the wrong verb: this suite cannot
reserve anything from a process it does not know about.

**A handshake: ask the server to prove it is ours.** Strictly stronger, and it
would catch the case where a foreign panel takes the port after the check and
the file's own panel dies unnoticed. But `explainEarlyDeath` already covers that
path from the other end, and a handshake means a header or an endpoint the panel
serves only so the tests can recognise it - shipping a seam in the product for
the suite's benefit. Not worth it for a window this narrow, and it is where to
go if the window is ever observed.

**Changing the derivation or the range.** The derivation is not the defect. It
is doing what it was built for: a stable port per worktree, so an author's URL
never moves and two checkouts can both run. A wider range or a test-only range
would lower the odds of an overlap without changing the failure when one
happens, and the failure was the entire cost here - three wrong diagnoses came
from what the collision looked like, not from how often it occurs. Making it
rarer would have made it harder to find. Nothing in the evidence points at the
range; every piece of it points at the suite believing a server it did not start.
