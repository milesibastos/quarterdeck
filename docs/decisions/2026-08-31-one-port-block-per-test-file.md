# One port block per test file, and a bounded stop

Date: 2026-08-31
Status: accepted

## Context

Every behavioural test starts a real panel on a real port, and `node --test`
runs test files in parallel. Ports were hand-picked per file: an author read
the other files, found a free range, and wrote the numbers down. Three files
had already reached for the same range. `tests/answering.test.ts` and
`tests/shipshape-lens.test.ts` overlapped on offsets 30-34, and
`tests/panel.test.ts` and `tests/real-fleet.test.ts` on 12-13.

A collision does not fail cleanly. The second panel never binds, its requests
are answered by the first file's server, and its assertions read as wrong
content rather than as a port clash. Worse, `stop()` waited on the child with
no bound: the loser did not fail, it hung. One such run wedged CI for fifty
minutes and taught nobody anything.

## Decision

**A test file claims a block by naming itself.** `portsFor(import.meta.filename)`
returns the file's own port supply; the block comes from where the file sorts
among the test files under `tests/`. Sorted position is a pure function of the
file's path, every test process computes the same answer from the same
directory, and two distinct paths cannot occupy one position. No file states a
port number, so no file can state one that is already taken.

**The claim is checked rather than assumed.** `allocate` refuses a claim list
in which two files land on the same block and names both, and refuses more
files than the range holds. A test in `tests/harness.test.ts` proves the
refusal, walks the real suite asserting every file's ports are disjoint, below
the ephemeral range, and clear of the port the panel itself would bind, and
fails any file whose `startPanel` calls do not trace back to the allocator -
checked by parsing the file, not by matching its source text.

**Stopping is bounded.** `stopChild` sends SIGTERM, waits ten seconds, then
sends SIGKILL and throws, naming the panel, the pid and the bound. A healthy
stop is under three and a half seconds - Next's production shutdown finishes
pending requests and then waits for the client's idle keep-alive sockets - so
ten seconds is threefold headroom, and a hanging child now fails one test in
seconds instead of wedging a run.

## Consequences

Adding, renaming or deleting a test file renumbers the blocks of the files that
sort after it. That is invisible - nothing names a port - but it means the ports
a given file uses are not stable across such a change. Stability is not
something the suite needs; disjointness is, and this buys disjointness by
construction rather than by review.

The block is sixteen ports. The hungriest file uses eleven, and the nine hundred
offsets the range offers hold fifty-six files at that size. (A thousand offsets
and sixty-two files since `2026-09-01-test-ports-live-above-the-panels.md` moved
the suite into a band of its own.) Both limits

- a file outgrowing its block, and the suite outgrowing the range - fail loudly
  when reached rather than wrapping around onto each other.

## Alternatives considered

**Hashing the file's name into a slot.** Stable when files are added or removed,
which sorted position is not. Rejected on arithmetic: fourteen files hashed into
ninety slots collide about two times in three, so the mechanism would spend most
of its life reporting the failure it exists to prevent.

**Asking the kernel for a free port.** The panel must be told its port before it
binds, so a test would have to bind, close and hand the number over - a window in
which anything on the machine can take it. Derivation has no window.
